/** Shared history selection for the dashboard and authenticated PDF export. */
export type HistoryMeal = { id: string; description: string; eatenAt: string | Date; kcal: number; protein: number; carbs: number };
export type HistoryGroup<M extends HistoryMeal = HistoryMeal> = {
  day: string; meals: M[]; totalKcal: number; totalProtein: number; totalCarbs: number;
};
export type HistorySort = "new" | "old" | "kcal-desc" | "kcal-asc";
export type HistoryOptions = { search: string; from: string; through: string; sort: HistorySort };

export function isValidDay(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const round = (value: number) => Math.round(value * 100) / 100;
export function historyTotals<M extends HistoryMeal>(groups: HistoryGroup<M>[]) {
  const meals = groups.flatMap((group) => group.meals);
  return { count: meals.length, days: groups.length, kcal: round(meals.reduce((sum, meal) => sum + meal.kcal, 0)),
    protein: round(meals.reduce((sum, meal) => sum + meal.protein, 0)),
    carbs: round(meals.reduce((sum, meal) => sum + meal.carbs, 0)) };
}

export function filterAndSortHistory<M extends HistoryMeal>(groups: HistoryGroup<M>[], options: HistoryOptions): HistoryGroup<M>[] {
  if (options.from && options.through && options.from > options.through) return [];
  const query = options.search.trim().toLocaleLowerCase();
  const compareTime = (a: M, b: M) => new Date(a.eatenAt).getTime() - new Date(b.eatenAt).getTime();
  const compare = (a: M, b: M) => {
    const difference = options.sort === "old" ? compareTime(a, b) : options.sort === "new" ? compareTime(b, a)
      : options.sort === "kcal-asc" ? a.kcal - b.kcal : b.kcal - a.kcal;
    return difference || compareTime(b, a) || a.id.localeCompare(b.id);
  };
  const visible = groups.filter((group) => (!options.from || group.day >= options.from) && (!options.through || group.day <= options.through))
    .map((group) => {
      const meals = group.meals.filter((meal) => meal.description.toLocaleLowerCase().includes(query)).sort(compare);
      const totals = historyTotals([{ ...group, meals }]);
      return { day: group.day, meals, totalKcal: totals.kcal, totalProtein: totals.protein, totalCarbs: totals.carbs };
    }).filter((group) => group.meals.length);
  return visible.sort((a, b) => {
    if (options.sort === "old") return a.day.localeCompare(b.day);
    if (options.sort === "new") return b.day.localeCompare(a.day);
    return compare(a.meals[0], b.meals[0]) || b.day.localeCompare(a.day);
  });
}

export function historyExportHref(options: HistoryOptions): string {
  const query = new URLSearchParams({ search: options.search.trim(), from: options.from, through: options.through, sort: options.sort });
  return `/api/meals/export?${query}`;
}
