import type { MealItemSnapshot } from "@/server/db/schema";
import type { Estimate, Resolution } from "./types";

export function toSnapshot(item: Resolution, databaseVersion: string): MealItemSnapshot {
  const n = item.nutrition;
  return { name: item.canonicalName ?? item.parsed.food, quantity: item.parsed.quantity, unit: item.parsed.unit ?? "serving",
    grams: item.portion?.basis === "g" ? item.portion.amount : null,
    kcal: n?.kcal ?? null, protein: n?.protein ?? null, carbs: n?.carbs ?? null, fat: n?.fat ?? null,
    fiber: n?.fiber ?? null, sugar: n?.sugar ?? null, source: n ? "local" : "unmatched", sourceId: n ? item.canonicalFoodId : null,
    uncertainty: item.warnings.join("; ").slice(0, 500) || null,
    matchConfidence: item.confidence === "exact" ? "high" : item.confidence === "unknown" ? "low" : item.confidence,
    assumptions: item.warnings.map((w) => w.slice(0, 500)).slice(0, 12),
    portionUncertainty: item.portion ? `${item.portion.source}: ${item.portion.description}`.slice(0, 500) : null,
    per100g: item.portion?.basis === "g" && item.per100 ? { kcal: item.per100.kcal, protein: item.per100.protein, carbs: item.per100.carbs,
      fat: item.per100.fat, fiber: item.per100.fiber, sugar: item.per100.sugar } : null,
    local: { rawText: item.parsed.rawText, normalizedText: item.parsed.normalizedText, foodId: item.canonicalFoodId,
      databaseVersion, method: item.method, confidence: item.confidence, source: item.source?.dataset ?? "Unknown local food",
      sourceRecordId: item.source?.id ?? null, license: item.source?.license ?? null,
      sourceVersion: item.source?.version ?? databaseVersion, portionBasis: item.portion?.basis ?? null,
      portionAmount: item.portion?.amount ?? null, recipeVersion: item.recipe?.version ?? null },
  };
}
export function toSnapshots(estimate: Estimate): MealItemSnapshot[] { return estimate.items.map((item) => toSnapshot(item, estimate.databaseVersion)); }
