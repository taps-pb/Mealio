import { describe, expect, it } from "vitest";
import { groupMealsByDay, localDayKey } from "./day";

const item = (at: string, kcal: number) => ({ eatenAt: new Date(at), kcal, protein: kcal / 10, carbs: kcal / 5 });

describe("owner-local meal day", () => {
  it("crosses midnight without relying on the server timezone", () => {
    expect(localDayKey(new Date("2024-03-10T07:30:00Z"), "America/Los_Angeles")).toBe("2024-03-09");
    expect(localDayKey(new Date("2024-03-10T08:30:00Z"), "America/Los_Angeles")).toBe("2024-03-10");
    expect(localDayKey(new Date("2024-06-01T23:30:00Z"), "Asia/Tokyo")).toBe("2024-06-02");
  });

  it("handles both DST transitions in New York", () => {
    expect(localDayKey(new Date("2024-03-10T06:30:00Z"), "America/New_York")).toBe("2024-03-10");
    expect(localDayKey(new Date("2024-03-10T07:00:00Z"), "America/New_York")).toBe("2024-03-10");
    expect(localDayKey(new Date("2024-11-03T04:30:00Z"), "America/New_York")).toBe("2024-11-03");
    expect(localDayKey(new Date("2024-11-03T06:30:00Z"), "America/New_York")).toBe("2024-11-03");
  });

  it("groups newest first and sums numeric snapshots", () => {
    const groups = groupMealsByDay([
      item("2024-06-01T23:30:00Z", 300),
      item("2024-06-02T01:00:00Z", 400),
      item("2024-06-02T15:00:00Z", 500),
    ], "America/Los_Angeles");
    expect(groups.map((group) => group.day)).toEqual(["2024-06-02", "2024-06-01"]);
    expect(groups[1].meals.map((meal) => meal.kcal)).toEqual([400, 300]);
    expect([groups[1].totalKcal, groups[1].totalProtein, groups[1].totalCarbs]).toEqual([700, 70, 140]);
    expect(groupMealsByDay([], "UTC")).toEqual([]);
  });

  it("keeps two-decimal sums stable", () => {
    const groups = groupMealsByDay([item("2024-06-01T00:00:00Z", 0.1), item("2024-06-01T01:00:00Z", 0.2)], "UTC");
    expect(groups[0].totalKcal).toBe(0.3);
  });

  it("rejects invalid instants and timezones even with empty input", () => {
    expect(() => localDayKey(new Date("bad"), "UTC")).toThrow("Invalid date or timezone");
    expect(() => groupMealsByDay([], "Not/AZone")).toThrow("Invalid date or timezone");
  });
});
