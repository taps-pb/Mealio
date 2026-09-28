import { readFile, stat } from "node:fs/promises";

import type { InterpretedItem } from "./interpret";

export type IndbRecord = {
  sourceId: string; name: string;
  kcalPer100g: number; proteinPer100g: number; carbsPer100g: number;
  servingUnit: string | null;
  servingKcal: number | null; servingProtein: number | null; servingCarbs: number | null;
};

type Candidate = { status: "candidate"; sourceId: string; grams: number | null;
  nutrients: { kcal: number; protein: number; carbs: number }; uncertainty: string };
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

function parseCatalog(raw: unknown): IndbRecord[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5000 || !raw.every(validRecord)) return null;
  const ids = new Set(raw.map((record: IndbRecord) => record.sourceId));
  return ids.size === raw.length ? raw : null;
}

function dishNames(name: string): string[] {
  // Only unqualified names before parentheses are eligible for exact aliases.
  const primary = name.split("(")[0];
  return [...new Set(primary.split("/").map(normalize).filter(Boolean))];
}

/** Never choose one of multiple recipes with the same dish name. */
export function matchIndbFood(item: InterpretedItem, records: IndbRecord[]): IndbResult {
  const name = singular(normalize(item.name));
  if (!name) return unmatched();
  const matches = records.filter((record) => dishNames(record.name).includes(name));
  if (matches.length !== 1) return unmatched();
  const record = matches[0];
  const note = "INDB (Anuvaad Solutions, 2024.11) reference recipe; ingredients, preparation and serving size may differ from yours.";
  const uncertainty = [item.uncertainty, note].filter(Boolean).join("; ");
  if (item.grams !== null && Number.isFinite(item.grams) && item.grams > 0 && item.grams <= 10000) {
    const grams = round2(item.grams);
    if (grams <= 0) return unmatched();
    const scale = item.grams / 100;
    const nutrients = { kcal: round2(record.kcalPer100g * scale), protein: round2(record.proteinPer100g * scale),
      carbs: round2(record.carbsPer100g * scale) };
    if (Object.values(nutrients).some((value) => value > 99_999_999.99)) return unmatched();
    return { status: "candidate", sourceId: record.sourceId, grams, nutrients, uncertainty };
  }
  const unit = item.unit ? singular(normalize(item.unit)) : "";
  const servingUnit = record.servingUnit ? singular(normalize(record.servingUnit)) : "";
  const namedServing = dishNames(record.name).includes(servingUnit);
  const namedPiece = (unit === "piece" || unit === "each") && namedServing;
  const usableUnit = unit === servingUnit || dishNames(record.name).includes(unit) || namedPiece || (!unit && namedServing);
  const impliedGrams = record.servingKcal !== null && record.kcalPer100g > 0
    ? 100 * record.servingKcal / record.kcalPer100g : 0;
  const viableServing = record.servingKcal !== null && record.servingProtein !== null &&
    record.servingCarbs !== null && impliedGrams >= 5 && impliedGrams <= 500;
  if (item.quantity === null || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 100 ||
      !servingUnit || !usableUnit) {
    const example = viableServing && servingUnit ? ` or an explicit count (e.g. "1 ${record.servingUnit} ${name}")` : "";
    return { status: "unmatched", reason: "portion_missing",
      uncertainty: `Enter a measured weight in grams${example}, then estimate again; no INDB portion was assumed` };
  }

  // A reference serving may have an unreliable portion size. Reject obvious
  // outliers without claiming that the ratio is a measured weight.
  if (!viableServing || record.servingKcal === null || record.servingProtein === null || record.servingCarbs === null) return unmatched();
  return { status: "candidate", sourceId: record.sourceId, grams: null,
    nutrients: { kcal: round2(record.servingKcal * item.quantity),
      protein: round2(record.servingProtein * item.quantity),
      carbs: round2(record.servingCarbs * item.quantity) },
    uncertainty: `${uncertainty} Assumed ${item.quantity} INDB standard ${record.servingUnit} serving${item.quantity === 1 ? "" : "s"}; confirm your portion.` };
}

let cached: { path: string; modified: number; size: number; records: IndbRecord[] | null } | null = null;

/** Disabled unless the owner explicitly supplies a private JSON catalog path. */
export async function lookupIndbFood(item: InterpretedItem): Promise<IndbResult> {
  const path = process.env.INDB_DATA_FILE;
  if (!path) return unmatched();
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 5_000_000) return unmatched();
    if (!cached || cached.path !== path || cached.modified !== metadata.mtimeMs || cached.size !== metadata.size) {
      cached = { path, modified: metadata.mtimeMs, size: metadata.size,
        records: parseCatalog(JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8"))) };
    }
    return cached.records ? matchIndbFood(item, cached.records) : unmatched();
  } catch {
    // Never leak a private path or workbook content in the response or logs.
    return unmatched();
  }
}
