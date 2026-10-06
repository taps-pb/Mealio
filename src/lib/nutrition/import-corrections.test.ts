import { describe, expect, it } from "vitest";
import { importReviewedCorrections } from "./import-corrections";
import { emptyUserData } from "./types";
import { createNutritionEngine } from "./runtime";
import { toSnapshots } from "./snapshots";

describe("reviewed correction import moved to library management", () => {
  it("preserves an explicit correction and does not duplicate it or change history", () => {
    const snapshot = { ...toSnapshots(createNutritionEngine().estimate("100 g apple"))[0], name: "My apple", source: "manual" as const, kcal: 75, protein: 1, carbs: 16, fat: 2 };
    const before = structuredClone(snapshot);
    const first = importReviewedCorrections(emptyUserData(), [snapshot]);
    expect(first.count).toBe(1);
    expect(createNutritionEngine(first.user).estimate("100 g My apple").totals).toMatchObject({ kcal: 75, protein: 1, carbs: 16, fat: 2 });
    expect(importReviewedCorrections(first.user, [snapshot]).count).toBe(0);
    expect(snapshot).toEqual(before);
  });
  it("excludes automatic estimates and incomplete corrections", () => {
    const snapshot = toSnapshots(createNutritionEngine().estimate("100 g apple"))[0];
    expect(importReviewedCorrections(emptyUserData(), [snapshot, { ...snapshot, source: "manual", fat: null }]).count).toBe(0);
  });
});
