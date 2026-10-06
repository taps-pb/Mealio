import { describe, expect, it } from "vitest";
import { mealEntryTime } from "./mealEntryTime";

describe("compact meal time labels", () => {
  it("labels device-local today and yesterday across a calendar boundary", () => {
    const now = new Date(2026, 9, 6, 0, 5);
    expect(mealEntryTime("2026-10-06T00:01", now)).toMatch(/^Today · /);
    expect(mealEntryTime("2026-10-05T23:55", now)).toMatch(/^Yesterday · /);
    expect(mealEntryTime("2026-10-04T23:55", now)).not.toMatch(/^(Today|Yesterday)/);
  });
  it("uses calendar yesterday across month/year boundaries and handles missing input", () => {
    expect(mealEntryTime("2025-12-31T23:55", new Date(2026, 0, 1, 0, 5))).toMatch(/^Yesterday · /);
    expect(mealEntryTime("2024-12-31T23:55", new Date(2026, 0, 1))).toContain("2024");
    expect(mealEntryTime("")).toBe("Choose date & time");
    expect(mealEntryTime("invalid")).toBe("Choose date & time");
  });
});
