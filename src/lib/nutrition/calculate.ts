import type { Nutrition } from "./types";

export const emptyNutrition = (): Nutrition => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 });

/** Single scaling boundary. No display rounding, hidden density or energy replacement. */
export function scaleNutrition(per100: Nutrition, amount: number): Nutrition {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) throw new Error("Invalid portion amount");
  return Object.fromEntries(Object.entries(per100).map(([key, value]) => {
    if (value === null) return [key, null];
    const scaled = value * amount / 100;
    if (!Number.isFinite(scaled) || scaled < 0) throw new Error("Invalid nutrition value");
    return [key, scaled];
  })) as Nutrition;
}

export function sumNutrition(values: Nutrition[]): Nutrition {
  return values.reduce((sum, entry) => Object.fromEntries(Object.keys(sum).map((key) => {
    const k = key as keyof Nutrition;
    return [k, sum[k] === null || entry[k] === null ? null : sum[k]! + entry[k]!];
  })) as Nutrition, emptyNutrition());
}
