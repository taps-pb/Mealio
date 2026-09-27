import type { InterpretedItem } from "./interpret";

type Nutrients = { kcal: number; protein: number; carbs: number };
export type LookupResult =
  | { status: "candidate"; sourceId: string; description: string; nutrients: Nutrients; uncertainty: string | null }
  | { status: "unmatched" | "unavailable"; uncertainty: string };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Returns a review candidate, never a confirmed nutrient value. */
export async function lookupUsdaFood(item: InterpretedItem, options: { fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<LookupResult> {
  if (item.grams === null) return { status: "unmatched", uncertainty: "Portion weight unknown; enter nutrients manually." };
  const key = options.apiKey ?? process.env.USDA_API_KEY;
  if (!key) return { status: "unavailable", uncertainty: "Nutrition lookup unavailable; enter nutrients manually." };
  try {
    const response = await (options.fetchImpl ?? fetch)(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: item.name, dataType: ["Foundation", "SR Legacy"], pageSize: 5 }),
      signal: AbortSignal.timeout(10000), cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable", uncertainty: "Nutrition lookup unavailable; enter nutrients manually." };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("foods" in payload) || !Array.isArray(payload.foods)) {
      return { status: "unavailable", uncertainty: "Nutrition lookup returned invalid data." };
    }
    for (const food of payload.foods) {
      if (!food || typeof food !== "object" || typeof food.description !== "string" || !Number.isInteger(food.fdcId) || !Array.isArray(food.foodNutrients)) continue;
      const query = normalize(item.name);
      const description = normalize(food.description);
      // Reject an unrelated top search hit instead of silently substituting it.
      if (!query || !(description === query || description.startsWith(query + " "))) continue;
      const get = (id: number) => {
        const value = food.foodNutrients.find((entry: { nutrientId?: number }) => entry?.nutrientId === id)?.value;
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
      };
      const kcal = get(1008), protein = get(1003), carbs = get(1005);
      if (kcal === null || protein === null || carbs === null) continue;
      const scale = item.grams / 100;
      return {
        status: "candidate", sourceId: String(food.fdcId), description: food.description,
        nutrients: { kcal: round2(kcal * scale), protein: round2(protein * scale), carbs: round2(carbs * scale) },
        uncertainty: [item.uncertainty, description !== query ? `Check USDA match: ${food.description}` : null].filter(Boolean).join("; ") || null,
      };
    }
    return { status: "unmatched", uncertainty: "No sufficiently matching USDA food with complete nutrients; enter values manually." };
  } catch {
    return { status: "unavailable", uncertainty: "Nutrition lookup unavailable; enter nutrients manually." };
  }
}
