import { describe, expect, it } from "vitest";
import { inferredFat, plausibleMacros } from "./sanity";

describe("nutrition sanity", () => {
  it("accepts ordinary foods and oils but rejects impossible values", () => {
    expect(plausibleMacros({ kcal: 77, protein: 2, carbs: 17, fat: .1 }, 100)).toBe(true);
    expect(plausibleMacros({ kcal: 884, protein: 0, carbs: 0, fat: 100 }, 100)).toBe(true);
    expect(plausibleMacros({ kcal: 1400, protein: 0, carbs: 0, fat: 155 }, 100)).toBe(false);
    expect(plausibleMacros({ kcal: 20, protein: 70, carbs: 0, fat: 0 }, 100)).toBe(false);
  });
  it("estimates missing fat only when the energy balance is reasonable", () => {
    expect(inferredFat(260, 5, 50, 200)).toBeGreaterThan(3);
    expect(inferredFat(50, 30, 30, 100)).toBeNull();
  });
});
