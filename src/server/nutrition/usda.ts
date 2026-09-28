import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { InterpretedItem } from "./interpret";

type Nutrients = { kcal: number; protein: number; carbs: number };
export type LookupResult =
  | { status: "candidate"; sourceId: string; description: string; grams: number; nutrients: Nutrients; uncertainty: string | null }
  | { status: "unmatched" | "unavailable"; uncertainty: string };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const round2 = (value: number) => Math.round(value * 100) / 100;
const countFoods = {
  egg: { query: "egg, whole, raw", description: "Egg, whole, raw, fresh", portion: "large", label: "large raw whole egg" },
  mango: { query: "mango, raw", description: "Mangos, raw", portion: "fruit without refuse", label: "whole raw mango (edible portion)" },
} as const;
type CountFood = keyof typeof countFoods;
const countName = (name: string): CountFood | null => {
  const normalized = normalize(name);
  if (normalized === "egg" || normalized === "eggs") return "egg";
  if (normalized === "mango" || normalized === "mangos" || normalized === "mangoes") return "mango";
  return null;
};
const isCountUnit = (unit: string | null) => unit === null || ["each", "piece", "pieces", "fruit"].includes(normalize(unit));

function parseKeyFile(raw: string): string | null {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  const match = /^USDA_API_KEY\s*=\s*(.*)$/.exec(lines[0]);
  let key = (match ? match[1] : lines[0]).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  return key && key.length <= 512 && !/[\s='"]/.test(key) ? key : null;
}

async function resolveApiKey(explicit: string | undefined): Promise<string | null> {
  if (explicit !== undefined) return explicit.trim() || null;
  if (process.env.USDA_API_KEY?.trim()) return process.env.USDA_API_KEY.trim();
  try {
    const file = process.env.USDA_KEY_FILE || resolve(process.cwd(), "../.secrets/usda_api.txt");
    // The local secret lives outside the deployable project; never bundle it.
    return parseKeyFile(await readFile(/* turbopackIgnore: true */ file, "utf8"));
  } catch {
    // Neither the secret's contents nor the file path belong in logs or responses.
    return null;
  }
}

/** Returns a review candidate, never a confirmed nutrient value. */
export async function lookupUsdaFood(item: InterpretedItem, options: { fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<LookupResult> {
  const kind = countName(item.name);
  const needsPortion = item.grams === null;
  if (needsPortion && (!kind || item.quantity === null || !isCountUnit(item.unit))) {
    return { status: "unmatched", uncertainty: "Portion weight unknown; enter nutrients manually." };
  }
  const key = await resolveApiKey(options.apiKey);
  if (!key) return { status: "unavailable", uncertainty: "Nutrition lookup unavailable; enter nutrients manually." };
  try {
    const query = kind ? countFoods[kind].query : item.name;
    const response = await (options.fetchImpl ?? fetch)(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, dataType: ["Foundation", "SR Legacy"], pageSize: 5 }),
      signal: AbortSignal.timeout(10000), cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable", uncertainty: "Nutrition lookup unavailable; enter nutrients manually." };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("foods" in payload) || !Array.isArray(payload.foods)) {
      return { status: "unavailable", uncertainty: "Nutrition lookup returned invalid data." };
    }
    for (const food of payload.foods) {
      if (!food || typeof food !== "object" || typeof food.description !== "string" || !Number.isInteger(food.fdcId) || !Array.isArray(food.foodNutrients)) continue;
      const normalizedQuery = normalize(query);
      const description = normalize(food.description);
      // Reject an unrelated top search hit instead of silently substituting it.
      if (kind ? description !== normalize(countFoods[kind].description) :
          !normalizedQuery || !(description === normalizedQuery || description.startsWith(normalizedQuery + " "))) continue;
      const get = (id: number) => {
        const value = food.foodNutrients.find((entry: { nutrientId?: number }) => entry?.nutrientId === id)?.value;
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
      };
      const kcal = get(1008), protein = get(1003), carbs = get(1005);
      if (kcal === null || protein === null || carbs === null) continue;
      let grams = item.grams;
      let portionNote: string | null = null;
      if (grams === null && kind && item.quantity !== null) {
        const detailResponse = await (options.fetchImpl ?? fetch)(`https://api.nal.usda.gov/fdc/v1/food/${food.fdcId}?api_key=${encodeURIComponent(key)}`, {
          signal: AbortSignal.timeout(10000), cache: "no-store",
        });
        if (!detailResponse.ok) return { status: "unavailable", uncertainty: "USDA portion lookup unavailable; enter nutrients manually." };
        const detail: unknown = await detailResponse.json();
        if (!detail || typeof detail !== "object" || !("description" in detail) ||
            typeof detail.description !== "string" || normalize(detail.description) !== normalize(countFoods[kind].description) ||
            !("foodPortions" in detail) || !Array.isArray(detail.foodPortions)) {
          return { status: "unmatched", uncertainty: "USDA portion not verified; enter weight and nutrients manually." };
        }
        const portion = detail.foodPortions.find((entry: { amount?: number; modifier?: string; gramWeight?: number }) =>
          entry?.amount === 1 && typeof entry.modifier === "string" &&
          normalize(entry.modifier) === normalize(countFoods[kind].portion) &&
          typeof entry.gramWeight === "number" && Number.isFinite(entry.gramWeight) && entry.gramWeight > 0);
        if (!portion || !Number.isFinite(item.quantity * portion.gramWeight) || item.quantity * portion.gramWeight > 10000) {
          return { status: "unmatched", uncertainty: "USDA portion weight unavailable; enter weight and nutrients manually." };
        }
        grams = round2(item.quantity * portion.gramWeight);
        portionNote = `Assumed ${item.quantity} × ${portion.gramWeight} g USDA ${countFoods[kind].portion} portion (${countFoods[kind].label}); confirm size and preparation.`;
      }
      if (grams === null) return { status: "unmatched", uncertainty: "Portion weight unknown; enter nutrients manually." };
      const scale = grams / 100;
      return {
        status: "candidate", sourceId: String(food.fdcId), description: food.description, grams,
        nutrients: { kcal: round2(kcal * scale), protein: round2(protein * scale), carbs: round2(carbs * scale) },
        uncertainty: [item.uncertainty, portionNote, description !== normalizedQuery ? `Check USDA match: ${food.description}` : null].filter(Boolean).join("; ") || null,
      };
    }
    return { status: "unmatched", uncertainty: "No sufficiently matching USDA food with complete nutrients; enter values manually." };
  } catch {
    return { status: "unavailable", uncertainty: "Nutrition lookup unavailable; enter nutrients manually." };
  }
}
