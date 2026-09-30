import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/request-origin", () => ({ acceptsSameOriginMutation: () => true }));
vi.mock("@/server/auth/session", () => ({ findSession: vi.fn().mockResolvedValue({ admin: { id: "owner" } }) }));
vi.mock("@/server/nutrition/interpret", () => ({ interpretMeal: vi.fn() }));
vi.mock("@/server/nutrition/recipe", () => ({ interpretRecipe: vi.fn() }));
vi.mock("@/server/nutrition/indb", () => ({ lookupIndbFood: vi.fn() }));
vi.mock("@/server/nutrition/usda", () => ({ lookupUsdaFood: vi.fn() }));
vi.mock("@/server/nutrition/personal", () => ({ getCachedResolution: vi.fn(), getPortionPreference: vi.fn(), putCachedResolution: vi.fn() }));

import { lookupIndbFood } from "@/server/nutrition/indb";
import { lookupUsdaFood } from "@/server/nutrition/usda";
import { interpretMeal } from "@/server/nutrition/interpret";
import { interpretRecipe } from "@/server/nutrition/recipe";
import { getCachedResolution, getPortionPreference, putCachedResolution } from "@/server/nutrition/personal";
import { findSession } from "@/server/auth/session";
import { POST } from "./route";

const request = (description: string) => new NextRequest("http://localhost:3000/api/estimate", {
  method: "POST", headers: { Origin: "http://localhost:3000", Cookie: "mealio_session=test" }, body: JSON.stringify({ description }),
});
const per100g = { kcal: 50, protein: 1, carbs: 12, fat: .2, fiber: 2, sugar: 7 };
const candidate = { status: "candidate" as const, sourceId: "123", description: "Apples, raw, with skin", grams: 182,
  nutrients: { kcal: 91, protein: 1.82, carbs: 21.84, fat: .36, fiber: 3.64, sugar: 12.74 }, per100g,
  uncertainty: "Estimated USDA medium serving; confirm weight.", portionUncertainty: "Estimated USDA medium serving; confirm weight.",
  matchConfidence: "medium" as const, assumptions: ["Estimated USDA medium serving; confirm weight."] };

describe("integrated nutrition estimate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(findSession).mockResolvedValue({ admin: { id: "owner" } } as Awaited<ReturnType<typeof findSession>>);
    vi.mocked(getCachedResolution).mockResolvedValue(null);
    vi.mocked(getPortionPreference).mockResolvedValue(null);
    vi.mocked(putCachedResolution).mockResolvedValue();
    vi.mocked(lookupIndbFood).mockResolvedValue({ status: "unmatched", reason: "no_match", uncertainty: "No verified INDB dish." });
    vi.mocked(lookupUsdaFood).mockResolvedValue(candidate);
  });

  it.each(["apple", "banana", "2 eggs", "200g cooked rice", "1 glass milk", "medium orange", "bananna"])("resolves %s without an LLM", async (description) => {
    const response = await POST(request(description));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.items[0]).toMatchObject({ source: "usda", fat: .36, matchConfidence: "medium" });
    expect(interpretMeal).not.toHaveBeenCalled();
    expect(interpretRecipe).not.toHaveBeenCalled();
    expect(putCachedResolution).toHaveBeenCalled();
  });

  it("uses a cached source resolution and a manually corrected portion", async () => {
    vi.mocked(getCachedResolution).mockResolvedValue({ name: "apple", quantity: 1, unit: "medium", grams: 182,
      kcal: 91, protein: 1.82, carbs: 21.84, fat: .36, source: "usda", sourceId: "123", uncertainty: null, per100g });
    vi.mocked(getPortionPreference).mockResolvedValue(200);
    const result = await (await POST(request("medium apple"))).json();
    expect(result.items[0]).toMatchObject({ grams: 200, kcal: 100, fat: .4, source: "usda" });
    expect(lookupUsdaFood).not.toHaveBeenCalled();
  });

  it("sums verified ingredients in a recipe rather than accepting LLM macros", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [{ name: "vegetable biryani", quantity: .5, unit: "plate", grams: null, uncertainty: null }] });
    vi.mocked(lookupUsdaFood).mockImplementation(async (item) => item.name === "cooked rice" || item.name === "oil"
      ? { ...candidate, grams: item.grams ?? 100, nutrients: { ...candidate.nutrients, kcal: item.name === "oil" ? 90 : 130 } }
      : { status: "unmatched", uncertainty: "No match" });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: true, name: "vegetable biryani", grams: 110,
      ingredients: [{ name: "cooked rice", grams: 100 }, { name: "oil", grams: 10 }],
      assumptions: ["Assumed cooking oil"], uncertainty: "Hypothetical recipe" });
    const result = await (await POST(request("half plate vegetable biryani"))).json();
    expect(result.items[0]).toMatchObject({ source: "recipe_estimate", kcal: 220, recipeUncertainty: "Hypothetical recipe" });
    expect(result.items[0].ingredients).toHaveLength(2);
  });

  it.each(["paneer butter masala", "chilli paneer"])("keeps %s distinct and computes ingredient totals", async (dish) => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [{ name: dish, quantity: 1, unit: "serving", grams: null, uncertainty: null }] });
    vi.mocked(lookupUsdaFood).mockImplementation(async (item) => item.name === "paneer" || item.name === "oil"
      ? { ...candidate, grams: item.grams ?? 100, nutrients: { ...candidate.nutrients,
        kcal: item.name === "paneer" ? 140 : 60, fat: item.name === "paneer" ? 8 : 6 } }
      : { status: "unmatched", uncertainty: "No match" });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: true, name: dish, grams: 160,
      ingredients: [{ name: "paneer", grams: 140 }, { name: "oil", grams: 20 }],
      assumptions: ["Assumed 20 g cooking oil"], uncertainty: "Hypothetical recipe" });
    const result = await (await POST(request(dish))).json();
    expect(result.items[0]).toMatchObject({ name: dish, source: "recipe_estimate", kcal: 200, fat: 14, matchConfidence: "low" });
    expect(result.items[0].assumptions).toContain("Assumed 20 g cooking oil");
  });

  it("leaves incomplete estimates visibly incomplete when providers or recipe fail", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [{ name: "unknown restaurant dish", quantity: 1, unit: "plate", grams: null, uncertainty: null }] });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unavailable", uncertainty: "Provider unavailable" });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: false, reason: "invalid_response" });
    const result = await (await POST(request("unknown restaurant dish"))).json();
    expect(result.incomplete).toBe(true);
    expect(result.totals).toBeNull();
    expect(result.items[0].source).toBe("unmatched");
  });
});
