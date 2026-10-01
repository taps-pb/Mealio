export type Macros = { kcal: number; protein: number; carbs: number; fat: number };
export const round2 = (number: number) => Math.round(number * 100) / 100;

/** Broad physical checks, not a claim that confidence is scientifically calibrated. */
export function plausibleMacros(values: Macros, grams: number): boolean {
  if (!Number.isFinite(grams) || grams <= 0 || grams > 10000) return false;
  const per100 = (value: number) => value * 100 / grams;
  if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0) ||
      per100(values.kcal) > 950 || [values.protein, values.carbs, values.fat].some((value) => per100(value) > 100) ||
      per100(values.protein + values.carbs + values.fat) > 112) return false;
  const energy = values.protein * 4 + values.carbs * 4 + values.fat * 9;
  return Math.abs(values.kcal - energy) <= Math.max(30 * grams / 100, .32 * Math.max(values.kcal, energy));
}

/** Energy balance is an approximation when fat is absent from a source. */
export function inferredFat(kcal: number, protein: number, carbs: number, grams: number): number | null {
  if (![kcal, protein, carbs, grams].every(Number.isFinite) || grams <= 0) return null;
  const remainder = kcal - 4 * (protein + carbs);
  if (remainder < -Math.max(20, kcal * .15)) return null;
  const fat = round2(Math.max(0, remainder / 9));
  return fat <= grams && plausibleMacros({ kcal, protein, carbs, fat }, grams) ? fat : null;
}
