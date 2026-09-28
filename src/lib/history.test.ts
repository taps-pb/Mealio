import { describe, expect, it } from "vitest";
import { filterAndSortHistory, historyExportHref, historyTotals, isValidDay, type HistoryGroup, type HistoryOptions } from "./history";

const groups: HistoryGroup[] = [
  { day: "2026-09-28", totalKcal: 400, totalProtein: 20, totalCarbs: 40, meals: [
    { id: "a", description: "Paneer", eatenAt: "2026-09-27T19:30:00Z", kcal: 300, protein: 15, carbs: 30 },
    { id: "b", description: "Tea", eatenAt: "2026-09-28T03:00:00Z", kcal: 100, protein: 5, carbs: 10 },
  ] },
  { day: "2026-09-27", totalKcal: 500, totalProtein: 30, totalCarbs: 50, meals: [
    { id: "c", description: "Paneer roti", eatenAt: "2026-09-27T16:00:00Z", kcal: 500, protein: 30, carbs: 50 },
  ] },
];
const options: HistoryOptions = { search: "", from: "", through: "", sort: "new" };

describe("history selection", () => {
  it("filters by inclusive owner-local day and meal name, recalculating visible totals", () => {
    const result = filterAndSortHistory(groups, { ...options, search: "paneer", from: "2026-09-28", through: "2026-09-28" });
    expect(result).toHaveLength(1);
    expect(result[0].meals.map((meal) => meal.id)).toEqual(["a"]);
    expect(historyTotals(result)).toEqual({ count: 1, days: 1, kcal: 300, protein: 15, carbs: 30 });
    expect(result[0].totalKcal).toBe(300);
  });
  it("orders dates and meals without mutating the originals", () => {
    const previous = JSON.stringify(groups);
    expect(filterAndSortHistory(groups, { ...options, sort: "old" }).map((group) => group.day)).toEqual(["2026-09-27", "2026-09-28"]);
    expect(filterAndSortHistory(groups, { ...options, sort: "kcal-desc" }).map((group) => group.day)).toEqual(["2026-09-27", "2026-09-28"]);
    expect(filterAndSortHistory(groups, { ...options, sort: "kcal-asc" })[0].meals[0].id).toBe("b");
    expect(JSON.stringify(groups)).toBe(previous);
  });
  it("rejects inverted range and distinguishes invalid days", () => {
    expect(filterAndSortHistory(groups, { ...options, from: "2026-09-28", through: "2026-09-27" })).toEqual([]);
    expect(isValidDay("2026-02-29")).toBe(false);
    expect(isValidDay("2024-02-29")).toBe(true);
  });
  it("builds a same-origin export URL", () => {
    const href = historyExportHref({ ...options, search: "paneer & roti" });
    expect(href.startsWith("/api/meals/export?")).toBe(true);
    expect(new URL(href, "https://mealio.test").searchParams.get("search")).toBe("paneer & roti");
  });
});
