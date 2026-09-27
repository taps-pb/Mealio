import { describe, expect, it } from "vitest";
import { sameSavedMeal } from "./service";
import type { Meal } from "@/server/db/schema";
import { mealInputSchema } from "./validation";

const input = mealInputSchema.parse({
  description: "Lunch", eatenAt: "2026-09-27T12:00:00Z", kcal: 550, protein: 30, carbs: 65,
  itemSnapshots: [], provenance: "corrected", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
});

describe("idempotent meal write", () => {
  it("recognizes exact retry but rejects reused key with changed nutrition or date", () => {
    const row = { ...input, id: "123e4567-e89b-42d3-a456-426614174001" } as Meal;
    expect(sameSavedMeal(row, input)).toBe(true);
    expect(sameSavedMeal(row, { ...input, kcal: 555 })).toBe(false);
    expect(sameSavedMeal(row, { ...input, eatenAt: new Date("2026-09-26T12:00:00Z") })).toBe(false);
  });
});
