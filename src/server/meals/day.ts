/** Return a UTC instant's calendar day in the owner's IANA timezone. */
export function localDayKey(instant: Date, timezone: string): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error("Invalid date or timezone");
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = get("year"), month = get("month"), day = get("day");
    if (!year || !month || !day) throw new Error();
    return `${year}-${month}-${day}`;
  } catch {
    throw new Error("Invalid date or timezone");
  }
}

export type MealDayGroup<T> = {
  day: string;
  meals: T[];
  totalKcal: number;
  totalProtein: number;
  totalCarbs: number;
};

export function groupMealsByDay<T extends { eatenAt: Date; kcal: number; protein: number; carbs: number }>(meals: T[], timezone: string): MealDayGroup<T>[] {
  localDayKey(new Date(0), timezone);
  const buckets = new Map<string, T[]>();
  for (const meal of meals) {
    const day = localDayKey(meal.eatenAt, timezone);
    buckets.set(day, [...(buckets.get(day) ?? []), meal]);
  }
  return [...buckets.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, items]) => {
    const sorted = [...items].sort((a, b) => b.eatenAt.getTime() - a.eatenAt.getTime());
    const sum = (select: (meal: T) => number) => Math.round(sorted.reduce((cents, meal) => cents + Math.round(select(meal) * 100), 0)) / 100;
    return {
      day, meals: sorted,
      totalKcal: sum((meal) => meal.kcal),
      totalProtein: sum((meal) => meal.protein),
      totalCarbs: sum((meal) => meal.carbs),
    };
  });
}
