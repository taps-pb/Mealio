import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HistoryPanel from "./HistoryPanel";

describe("history calorie display", () => {
  it("formats meal, day, and filtered summary kcal without rounding meal data", () => {
    const groups = [{ day: "2026-10-02", totalKcal: 1850.57, totalProtein: 15, totalCarbs: 20,
      meals: [{ id: "meal-1", description: "Idli", eatenAt: "2026-10-02T06:30:00Z", kcal: 1850.57,
        protein: 15, carbs: 20, itemSnapshots: [] }] }];
    const html = renderToStaticMarkup(createElement(HistoryPanel, {
      groups, timezone: "Asia/Kolkata", onOpenDetails: () => {},
    }));
    expect(html).toContain("1,850.6 kcal shown");
    expect(html).toContain("1,850.6 kcal");
    expect(html).not.toContain("1850.57");
    expect(groups[0].meals[0].kcal).toBe(1850.57);
  });
});
