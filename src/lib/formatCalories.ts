/** Format calories only at the presentation boundary; never round saved data. */
const calorieFormatter = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

export function formatCalories(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "0";
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return "0";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? calorieFormatter.format(numeric) : "0";
}
