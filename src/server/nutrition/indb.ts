import { readFile, stat } from "node:fs/promises";
import { eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { indbCatalogs } from "../db/schema";
import type { InterpretedItem } from "./interpret";

export type IndbRecord = {
  sourceId: string; name: string;
  kcalPer100g: number; proteinPer100g: number; carbsPer100g: number;
  servingUnit: string | null;
  servingKcal: number | null; servingProtein: number | null; servingCarbs: number | null;
};

type Candidate = { status: "candidate"; sourceId: string; grams: number | null;
  nutrients: { kcal: number; protein: number; carbs: number };
  per100g: { kcal: number; protein: number; carbs: number; fat: null; fiber: null; sugar: null }; uncertainty: string };
type Unmatched = { status: "unmatched"; reason: "no_match" | "portion_missing"; uncertainty: string };
export type IndbResult = Candidate | Unmatched;

const unmatched = (): Unmatched => ({ status: "unmatched", reason: "no_match", uncertainty: "No verified INDB dish and portion match." });
const round2 = (value: number) => Math.round(value * 100) / 100;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const singular = (value: string) => value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
const validNutrient = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000;

function validRecord(raw: unknown): raw is IndbRecord {
  if (!raw || typeof raw !== "object") return false;
  const record = raw as Record<string, unknown>;
  if (typeof record.sourceId !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(record.sourceId) ||
      typeof record.name !== "string" || !record.name.trim() || record.name.length > 200 ||
      !validNutrient(record.kcalPer100g) || !validNutrient(record.proteinPer100g) || !validNutrient(record.carbsPer100g)) return false;
  const servingValues = [record.servingKcal, record.servingProtein, record.servingCarbs];
  if (record.servingUnit === null) return servingValues.every((value) => value === null);
  return typeof record.servingUnit === "string" && record.servingUnit.trim().length > 0 &&
    record.servingUnit.length <= 50 && servingValues.every(validNutrient);
}

export function parseIndbCatalog(raw: unknown): IndbRecord[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5000 || !raw.every(validRecord)) return null;
  const ids = new Set(raw.map((record: IndbRecord) => record.sourceId));
  return ids.size === raw.length ? raw : null;
}

function dishNames(name: string): string[] {
  const primary = name.split("(")[0];
  const aliases = primary.split("/").map(normalize).filter(Boolean);
  // Parenthetical names are eligible only as complete, qualified dish names.
  // A bare "burfi" or "curry" is too broad to identify a particular recipe.
  for (const group of name.matchAll(/\(([^()]*)\)/g)) {
    aliases.push(...group[1].split("/").map(normalize).filter((alias) => alias.split(" ").length >= 2));
  }
  return [...new Set(aliases)];
}

/** Never choose one of multiple recipes with the same dish name. */
export function matchIndbFood(item: InterpretedItem, records: IndbRecord[]): IndbResult {
  const name = singular(normalize(item.name));
  if (!name) return unmatched();
  const matches = records.filter((record) => dishNames(record.name).includes(name));
  if (matches.length !== 1) return unmatched();
  const record = matches[0];
  const per100g = { kcal: record.kcalPer100g, protein: record.proteinPer100g, carbs: record.carbsPer100g,
    fat: null, fiber: null, sugar: null } as const;
  const note = "INDB (Anuvaad Solutions, 2024.11) reference recipe; ingredients, preparation and serving size may differ from yours.";
  const uncertainty = [item.uncertainty, note].filter(Boolean).join("; ");
  if (item.grams !== null && Number.isFinite(item.grams) && item.grams > 0 && item.grams <= 10000) {
    const grams = round2(item.grams);
    if (grams <= 0) return unmatched();
    const scale = item.grams / 100;
    const nutrients = { kcal: round2(record.kcalPer100g * scale), protein: round2(record.proteinPer100g * scale),
      carbs: round2(record.carbsPer100g * scale) };
    if (Object.values(nutrients).some((value) => value > 99_999_999.99)) return unmatched();
    return { status: "candidate", sourceId: record.sourceId, grams, nutrients, per100g, uncertainty };
  }
  const unit = item.unit ? singular(normalize(item.unit)) : "";
  const servingUnit = record.servingUnit ? singular(normalize(record.servingUnit)) : "";
  const namedServing = dishNames(record.name).includes(servingUnit);
  // A catalog "burfi" serving is one sweet. Only an exact, unique burfi dish
  // can treat an explicit piece/each count as that reference serving.
  const burfiPiece = servingUnit === "burfi" && /\bburfi\b/.test(normalize(record.name.split("(")[0]));
  const namedPiece = (unit === "piece" || unit === "each") && (namedServing || burfiPiece);
  const usableUnit = unit === servingUnit || dishNames(record.name).includes(unit) || namedPiece || (!unit && namedServing);
  const impliedGrams = record.servingKcal !== null && record.kcalPer100g > 0
    ? 100 * record.servingKcal / record.kcalPer100g : 0;
  const viableServing = record.servingKcal !== null && record.servingProtein !== null &&
    record.servingCarbs !== null && impliedGrams >= 5 && impliedGrams <= 500;
  if (item.quantity === null || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 100 ||
      !servingUnit || !usableUnit) {
    const suggestedUnit = burfiPiece ? "piece" : record.servingUnit;
    const example = viableServing && suggestedUnit ? ` or an explicit count (e.g. "1 ${suggestedUnit} ${name}")` : "";
    return { status: "unmatched", reason: "portion_missing",
      uncertainty: `INDB dish found, but portion missing. Enter a measured weight in grams${example}, then estimate again; no INDB portion was assumed` };
  }

  // A reference serving may have an unreliable portion size. Reject obvious
  // outliers without claiming that the ratio is a measured weight.
  if (!viableServing || record.servingKcal === null || record.servingProtein === null || record.servingCarbs === null) return unmatched();
  return { status: "candidate", sourceId: record.sourceId, grams: null, per100g,
    nutrients: { kcal: round2(record.servingKcal * item.quantity),
      protein: round2(record.servingProtein * item.quantity),
      carbs: round2(record.servingCarbs * item.quantity) },
    uncertainty: `${uncertainty} Assumed ${item.quantity} INDB standard ${record.servingUnit} serving${item.quantity === 1 ? "" : "s"}; confirm your portion.` };
}

let cached: { path: string; modified: number; size: number; records: IndbRecord[] | null } | null = null;
let databaseCache: { records: IndbRecord[] | null; expiresAt: number } | null = null;
let loadingDatabase: Promise<IndbRecord[] | null> | null = null;
const DATABASE_CACHE_MS = 5 * 60 * 1000;

async function loadDatabaseCatalog(): Promise<IndbRecord[] | null> {
  try {
    const [row] = await getDb().select({ records: indbCatalogs.records }).from(indbCatalogs)
      .where(eq(indbCatalogs.id, "private")).limit(1);
    return parseIndbCatalog(row?.records);
  } catch {
    // Neither database errors nor private catalog contents belong in a response.
    return null;
  }
}

async function databaseCatalog(): Promise<IndbRecord[] | null> {
  if (databaseCache && Date.now() < databaseCache.expiresAt) return databaseCache.records;
  if (!loadingDatabase) {
    loadingDatabase = loadDatabaseCatalog().then((records) => {
      databaseCache = { records, expiresAt: Date.now() + DATABASE_CACHE_MS };
      return records;
    }).finally(() => { loadingDatabase = null; });
  }
  return loadingDatabase;
}

/** Test-only cache reset. No production endpoint calls this. */
export function resetIndbDatabaseCacheForTests(): void {
  databaseCache = null;
  loadingDatabase = null;
}

/** Disabled unless the owner explicitly selects the database or a private local JSON file. */
export async function lookupIndbFood(item: InterpretedItem): Promise<IndbResult> {
  if (process.env.INDB_CATALOG_SOURCE === "database") {
    const records = await databaseCatalog();
    return records ? matchIndbFood(item, records) : unmatched();
  }
  const path = process.env.INDB_DATA_FILE;
  if (!path) return unmatched();
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 5_000_000) return unmatched();
    if (!cached || cached.path !== path || cached.modified !== metadata.mtimeMs || cached.size !== metadata.size) {
      cached = { path, modified: metadata.mtimeMs, size: metadata.size,
        records: parseIndbCatalog(JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8"))) };
    }
    return cached.records ? matchIndbFood(item, cached.records) : unmatched();
  } catch {
    // Never leak a private path or workbook content in the response or logs.
    return unmatched();
  }
}
