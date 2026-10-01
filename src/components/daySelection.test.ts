import { describe, expect, it } from "vitest";
import { dayTitle, groupForDay, stepDayKey } from "./daySelection";

describe("owner-local day navigation", () => {
  it("moves over month, year and leap-day boundaries without device-timezone math", () => {
    expect(stepDayKey("2026-10-01", -1)).toBe("2026-09-30");
    expect(stepDayKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(stepDayKey("2024-03-01", -1)).toBe("2024-02-29");
    expect(stepDayKey("2024-03-10", 1)).toBe("2024-03-11"); // DST elsewhere cannot shift this date.
    expect(stepDayKey("2026-02-29", -1)).toBe("2026-02-29");
  });

  it("labels yesterday relative to the account day, not the device day", () => {
    expect(dayTitle("2026-09-30", "2026-10-01")).toBe("Yesterday");
    expect(dayTitle("2026-10-01", "2026-10-01")).toBe("Today");
    expect(dayTitle("2026-09-29", "2026-10-01")).toBe("Selected day");
  });

  it("selects yesterday's ring meals and totals from owner-local history, not today's", () => {
    const groups = [
      { day: "2026-10-01", meals: [{ id: "today", kcal: 200 }], totalProtein: 10 },
      { day: "2026-09-30", meals: [{ id: "yesterday", kcal: 430 }], totalProtein: 23 },
    ];
    const yesterday = stepDayKey("2026-10-01", -1);
    expect(groupForDay(groups, yesterday)).toMatchObject({ meals: [{ id: "yesterday", kcal: 430 }], totalProtein: 23 });
    expect(groupForDay(groups, "2026-09-29")).toBeUndefined();
  });
});
