import { describe, expect, it, vi } from "vitest";
import { lookupUsdaFood } from "./usda";

const item = { name: "chicken breast", quantity: 1, unit: "portion", grams: 150, uncertainty: "Estimated weight" };
const testApiKey = ["test", "placeholder"].join("-");
const food = { fdcId: 123, description: "Chicken breast", foodNutrients: [
  { nutrientId: 1008, value: 165 }, { nutrientId: 1003, value: 31 }, { nutrientId: 1005, value: 0 },
] };
const response = (foods: unknown[]) => new Response(JSON.stringify({ foods }), { status: 200 });

describe("USDA review candidates", () => {
  it("scales per-100g nutrients and retains portion uncertainty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([food]));
    const result = await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl });
    expect(result).toEqual({ status: "candidate", sourceId: "123", description: "Chicken breast", nutrients: { kcal: 247.5, protein: 46.5, carbs: 0 }, uncertainty: "Estimated weight" });
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string).query).toBe("chicken breast");
  });

  it("rejects unrelated hits, missing nutrients, and unknown weight", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([{ ...food, description: "Chicken thigh" }]));
    expect((await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
    fetchImpl.mockResolvedValue(response([{ ...food, foodNutrients: food.foodNutrients.slice(0, 2) }]));
    expect((await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
    expect((await lookupUsdaFood({ ...item, grams: null }, { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
  });

  it("returns generic unavailable failures without leaking a key", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("secret provider detail"));
    const result = await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl });
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain(testApiKey);
  });
});
