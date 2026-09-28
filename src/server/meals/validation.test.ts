import { describe, expect, it } from "vitest";
import { mealInputSchema, mealUpdateSchema } from "./validation";

const valid = {
  description: " Eggs and toast ", eatenAt: "2024-06-01T12:00:00-04:00",
  kcal: 320.5, protein: 18, carbs: 35,
  itemSnapshots: [{ name: "eggs", quantity: 2, unit: "each", grams: null, kcal: null, protein: null, carbs: null, source: "unmatched", sourceId: null, uncertainty: "portion unknown" }],
  provenance: "corrected", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
};

describe("meal save boundary", () => {
  it("accepts explicit offset and preserves manual totals with incomplete items", () => {
    const result = mealInputSchema.parse(valid);
    expect(result.description).toBe("Eggs and toast");
    expect(result.eatenAt.toISOString()).toBe("2024-06-01T16:00:00.000Z");
    expect(result.itemSnapshots[0].kcal).toBeNull();
  });

  it("rejects timezone-less or invalid instants and invalid nutrients", () => {
    for (const eatenAt of ["2024-06-01T12:00:00", "2024-02-30T12:00:00Z"]) {
      expect(mealInputSchema.safeParse({ ...valid, eatenAt }).success).toBe(false);
    }
    for (const kcal of [-1, 1.234, Infinity, NaN]) {
      expect(mealInputSchema.safeParse({ ...valid, kcal }).success).toBe(false);
    }
  });

  it("requires per-item provenance and an idempotency UUID", () => {
    expect(mealInputSchema.safeParse({ ...valid, idempotencyKey: "not-a-uuid" }).success).toBe(false);
    expect(mealInputSchema.safeParse({ ...valid, itemSnapshots: [{ ...valid.itemSnapshots[0], uncertainty: null }] }).success).toBe(false);
    expect(mealInputSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
    const { idempotencyKey: _key, ...update } = valid;
    expect(mealUpdateSchema.safeParse(update).success).toBe(true);
    expect(_key).toBeTruthy();
  });

  it("preserves an INDB candidate with a source ID and visible uncertainty", () => {
    const candidate = { ...valid.itemSnapshots[0], source: "indb", sourceId: "TEST001",
      kcal: 120, protein: 4, carbs: 20, uncertainty: "Reference recipe and serving size may vary." };
    expect(mealInputSchema.safeParse({ ...valid, itemSnapshots: [candidate] }).success).toBe(true);
    expect(mealInputSchema.safeParse({ ...valid, itemSnapshots: [{ ...candidate, sourceId: null }] }).success).toBe(false);
    expect(mealInputSchema.safeParse({ ...valid, itemSnapshots: [{ ...candidate, uncertainty: null }] }).success).toBe(false);
    expect(mealInputSchema.safeParse({ ...valid, itemSnapshots: [{ ...candidate, source: "manual" }] }).success).toBe(false);
    expect(mealInputSchema.safeParse({ ...valid, itemSnapshots: [{ ...candidate, source: "manual", sourceId: null }] }).success).toBe(true);
  });
});
