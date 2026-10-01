import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/request-origin", () => ({ acceptsSameOriginMutation: () => true }));
vi.mock("@/server/auth/session", () => ({ findSession: vi.fn().mockResolvedValue({ admin: { id: "owner" } }) }));
vi.mock("@/server/nutrition/interpret", () => ({ interpretMeal: vi.fn() }));
vi.mock("@/server/nutrition/recipe", () => ({ interpretRecipe: vi.fn() }));
vi.mock("@/server/nutrition/indb", () => ({ lookupIndbFood: vi.fn() }));
vi.mock("@/server/nutrition/usda", () => ({ lookupUsdaFood: vi.fn() }));
vi.mock("@/server/nutrition/personal", () => ({ getCachedResolution: vi.fn(), getPortionPreference: vi.fn(), putCachedResolution: vi.fn() }));
vi.mock("@/server/nutrition/fallback", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/nutrition/fallback")>(),
  estimateMissingIngredients: vi.fn(), estimateWholeDish: vi.fn(),
}));

import { lookupIndbFood } from "@/server/nutrition/indb";
import { lookupUsdaFood } from "@/server/nutrition/usda";
import { interpretMeal } from "@/server/nutrition/interpret";
import { interpretRecipe } from "@/server/nutrition/recipe";
import { getCachedResolution, getPortionPreference, putCachedResolution } from "@/server/nutrition/personal";
import { findSession } from "@/server/auth/session";
import { estimateMissingIngredients, estimateWholeDish } from "@/server/nutrition/fallback";
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
    vi.mocked(estimateMissingIngredients).mockResolvedValue([]);
    vi.mocked(estimateWholeDish).mockResolvedValue(null);
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
    vi.mocked(lookupUsdaFood).mockImplementation(async (item) => {
      if (item.name !== "paneer" && item.name !== "oil") return { status: "unmatched", uncertainty: "No match" };
      const base = item.name === "paneer" ? { kcal: 265, protein: 18, carbs: 4, fat: 20 } :
        { kcal: 884, protein: 0, carbs: 0, fat: 100 };
      const grams = item.grams ?? 100;
      return { ...candidate, grams, per100g: { ...base, fiber: null, sugar: null },
        nutrients: { kcal: Math.round(base.kcal * grams) / 100, protein: Math.round(base.protein * grams) / 100,
          carbs: Math.round(base.carbs * grams) / 100, fat: Math.round(base.fat * grams) / 100, fiber: null, sugar: null } };
    });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: true, name: dish, grams: 160,
      ingredients: [{ name: "paneer", grams: 140 }, { name: "oil", grams: 20 }],
      assumptions: ["Assumed 20 g cooking oil"], uncertainty: "Hypothetical recipe" });
    const result = await (await POST(request(dish))).json();
    expect(result.items[0]).toMatchObject({ name: dish, source: "recipe_estimate", kcal: 547.8, fat: 48, matchConfidence: "low" });
    expect(result.items[0].assumptions).toContain("Assumed 20 g cooking oil");
  });

  it("reuses an owner-confirmed recipe serving and recalculates each ingredient", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [{ name: "biryani", quantity: .5, unit: "plate", grams: null, uncertainty: null }] });
    vi.mocked(getPortionPreference).mockImplementation(async (_adminId, item) => item.name === "biryani" ? 640 : null);
    vi.mocked(lookupUsdaFood).mockImplementation(async (item) => {
      if (item.name === "biryani") return { status: "unmatched", uncertainty: "No exact source" };
      const base = item.name === "cooked rice" ? { kcal: 130, protein: 2.7, carbs: 28, fat: .3 } :
        { kcal: 884, protein: 0, carbs: 0, fat: 100 };
      const grams = item.grams ?? 100;
      return { ...candidate, grams, per100g: { ...base, fiber: null, sugar: null },
        nutrients: { kcal: Math.round(base.kcal * grams) / 100, protein: Math.round(base.protein * grams) / 100,
          carbs: Math.round(base.carbs * grams) / 100, fat: Math.round(base.fat * grams) / 100, fiber: null, sugar: null } };
    });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: true, name: "biryani", grams: 250,
      ingredients: [{ name: "cooked rice", grams: 200 }, { name: "vegetable oil", grams: 50 }],
      assumptions: ["Assumed cooking oil"], uncertainty: "Hypothetical recipe" });
    const result = await (await POST(request("half plate biryani"))).json();
    expect(result.items[0]).toMatchObject({ source: "recipe_estimate", grams: 320, kcal: 898.56 });
    expect(result.items[0].ingredients.map((ingredient: { grams: number }) => ingredient.grams)).toEqual([256, 64]);
    expect(result.items[0].portionUncertainty).toContain("your saved 640 g per plate");
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

  it("retains a confirmed portion without inventing macros when a recipe provider fails", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [{ name: "biryani", quantity: .5, unit: "plate", grams: null, uncertainty: null }] });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unavailable", uncertainty: "Provider unavailable" });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: false, reason: "invalid_response" });
    vi.mocked(getPortionPreference).mockResolvedValue(640);
    const result = await (await POST(request("half plate biryani"))).json();
    expect(result.items[0]).toMatchObject({ source: "unmatched", grams: 320, kcal: null });
    expect(result.items[0].portionUncertainty).toContain("your saved 640 g per plate");
    expect(result.totals).toBeNull();
  });

  it("gives 2 aloo pyaaz paratha plausible complete macros despite unresolved seasonings", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [
      { name: "aloo pyaaz paratha", quantity: 2, unit: "piece", grams: null, uncertainty: "Size estimated" },
    ] });
    const weights = [ ["whole wheat flour", 120], ["potato", 98], ["onion", 35], ["ghee", 22],
      ["vegetable oil", 10], ["water", 9], ["cumin seeds", 2], ["red chilli powder", 2], ["coriander leaves", 2] ] as const;
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: true, name: "aloo pyaaz paratha", grams: 300,
      ingredients: weights.map(([name, grams]) => ({ name, grams })), assumptions: ["Two medium pan-fried stuffed parathas"],
      uncertainty: "Typical homemade recipe" });
    const values: Record<string, { kcal: number; protein: number; carbs: number; fat: number }> = {
      "whole wheat flour": { kcal: 340, protein: 13, carbs: 72, fat: 2.5 },
      potato: { kcal: 77, protein: 2, carbs: 17, fat: .1 }, onion: { kcal: 40, protein: 1.1, carbs: 9.3, fat: .1 },
      ghee: { kcal: 900, protein: 0, carbs: 0, fat: 100 }, "vegetable oil": { kcal: 884, protein: 0, carbs: 0, fat: 100 },
      water: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, "cumin seeds": { kcal: 375, protein: 18, carbs: 44, fat: 22 },
    };
    vi.mocked(lookupUsdaFood).mockImplementation(async (item) => {
      const reference = values[item.name];
      if (!reference) return { status: "unmatched", uncertainty: "No safe source" };
      const grams = item.grams ?? 100;
      const scale = (value: number) => Math.round(value * grams) / 100;
      return { ...candidate, description: item.name === "potato" ? "Potatoes, flesh and skin, raw" : item.name,
        grams, per100g: { ...reference, fiber: null, sugar: null },
        nutrients: { kcal: scale(reference.kcal), protein: scale(reference.protein), carbs: scale(reference.carbs),
          fat: scale(reference.fat), fiber: null, sugar: null } };
    });
    vi.mocked(estimateMissingIngredients).mockResolvedValue([{ name: "coriander leaves", grams: 2,
      nutrients: { kcal: 1, protein: .1, carbs: .2, fat: .01 }, assumption: "Approximate herb composition" }]);
    const result = await (await POST(request("2 aloo pyaaz paratha"))).json();
    const paratha = result.items[0];
    expect(paratha).toMatchObject({ source: "recipe_estimate", quantity: 2, unit: "piece", grams: 300, matchConfidence: "low" });
    expect(paratha.kcal).toBeGreaterThan(700); expect(paratha.kcal).toBeLessThan(850);
    expect(paratha.protein).toBeGreaterThan(15); expect(paratha.protein).toBeLessThan(25);
    expect(paratha.carbs).toBeGreaterThan(95); expect(paratha.carbs).toBeLessThan(125);
    expect(paratha.fat).toBeGreaterThan(25); expect(paratha.fat).toBeLessThan(40);
    expect(result.totals).not.toBeNull();
    expect(paratha.ingredients.find((entry: { name: string }) => entry.name === "potato").source).toBe("usda");
    expect(paratha.ingredients.find((entry: { name: string }) => entry.name === "red chilli powder").source).toBe("estimated");
    expect(paratha.ingredients.find((entry: { name: string }) => entry.name === "coriander leaves").source).toBe("estimated");
    expect(paratha.ingredients.some((entry: { uncertainty: string | null }) => entry.uncertainty?.includes("potato bread"))).toBe(false);
  });

  it("keeps a recipe complete when a tiny spice cannot be found by USDA or the model", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [
      { name: "homemade rice dish", quantity: 1, unit: "plate", grams: null, uncertainty: null },
    ] });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: true, name: "homemade rice dish", grams: 217,
      ingredients: [{ name: "cooked rice", grams: 200 }, { name: "vegetable oil", grams: 15 },
        { name: "unknown spice", grams: 2 }], assumptions: ["Typical oil"], uncertainty: "Unknown seasoning" });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unmatched", uncertainty: "No reliable match" });
    const result = await (await POST(request("homemade rice dish"))).json();
    expect(result.items[0].ingredients.find((entry: { name: string }) => entry.name === "unknown spice"))
      .toMatchObject({ source: "estimated", kcal: 6 });
    expect(result.items[0]).toMatchObject({ source: "recipe_estimate", grams: 217 });
    expect(result.totals?.kcal).toBeGreaterThan(350);
    expect(result.totals?.fat).toBeGreaterThan(14);
    expect(result.incomplete).toBe(false);
  });

  it("fills a banana from a labeled local composition if USDA is unavailable", async () => {
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unavailable", uncertainty: "Lookup unavailable" });
    const result = await (await POST(request("1 banana"))).json();
    expect(result.items[0]).toMatchObject({ source: "estimated", grams: 118, matchConfidence: "low" });
    expect(result.totals.kcal).toBeGreaterThan(95);
    expect(result.totals.fat).not.toBeNull();
    expect(interpretMeal).not.toHaveBeenCalled();
  });

  it("keeps an owner-confirmed portion when a simple food uses approximate nutrition", async () => {
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unmatched", uncertainty: "No reliable reference" });
    vi.mocked(getPortionPreference).mockResolvedValue(160);
    const result = await (await POST(request("1 banana"))).json();
    expect(result.items[0]).toMatchObject({ source: "estimated", grams: 160, quantity: 1 });
    expect(result.items[0].assumptions.join(" ")).toContain("saved 160 g");
    expect(result.totals.kcal).toBeGreaterThan(130);
  });

  it("does not leave fat blank when a reference lacks fat and a coherent whole-dish estimate is available", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [
      { name: "paneer tikka", quantity: 1, unit: "plate", grams: 200, uncertainty: null },
    ] });
    vi.mocked(lookupIndbFood).mockResolvedValue({ status: "candidate", sourceId: "paneer-tikka",
      grams: 200, per100g: { kcal: 50, protein: 10, carbs: 6, fat: null, fiber: null, sugar: null },
      nutrients: { kcal: 100, protein: 20, carbs: 12 }, uncertainty: "Reference has no fat" });
    vi.mocked(estimateWholeDish).mockResolvedValue({ name: "paneer tikka", grams: 200,
      nutrients: { kcal: 390, protein: 22, carbs: 14, fat: 27 }, assumption: "Typical preparation",
      assumptions: ["Paneer and oil estimated"] });
    const result = await (await POST(request("paneer tikka"))).json();
    expect(result.items[0].fat).toBe(27);
    expect(result.totals.fat).toBe(27);
    expect(result.items[0].uncertainty).toContain("reference did not provide");
  });

  it.each(["paneer tikka", "rajma chawal", "2 roti with dal", "vegetable biryani"])("uses a coherent low-confidence meal estimate for %s when references fail", async (dish) => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [{ name: dish, quantity: 1, unit: "serving", grams: null, uncertainty: null }] });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unmatched", uncertainty: "No safe match" });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: false, reason: "invalid_response" });
    vi.mocked(estimateWholeDish).mockResolvedValue({ name: dish, grams: 300,
      nutrients: { kcal: 480, protein: 18, carbs: 60, fat: 19 }, assumption: "Typical recipe estimate",
      assumptions: ["Typical homemade ingredients"] });
    const result = await (await POST(request(dish))).json();
    expect(result.items[0]).toMatchObject({ source: "estimated", grams: 300, fat: 19, matchConfidence: "low" });
    expect(result.totals).toMatchObject({ kcal: 480, protein: 18, carbs: 60, fat: 19 });
  });

  it("estimates each interpreted food separately instead of counting roti twice in a dal fallback", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [
      { name: "roti", quantity: 2, unit: "piece", grams: null, uncertainty: null },
      { name: "dal", quantity: 1, unit: "bowl", grams: null, uncertainty: null },
    ] });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unmatched", uncertainty: "No exact match" });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: false, reason: "invalid_response" });
    vi.mocked(estimateWholeDish).mockImplementation(async (description, item) => {
      if (description.includes("with")) return null;
      return { name: item.name, grams: item.name === "roti" ? 120 : 200,
        nutrients: item.name === "roti" ? { kcal: 240, protein: 7, carbs: 44, fat: 4 } :
          { kcal: 220, protein: 12, carbs: 25, fat: 8 },
        assumption: "Typical preparation", assumptions: ["Typical serving"] };
    });
    const result = await (await POST(request("2 roti with dal"))).json();
    expect(result.totals).toMatchObject({ kcal: 460, protein: 19, carbs: 69, fat: 12 });
    expect(vi.mocked(estimateWholeDish).mock.calls.map(([description]) => description)).not.toContain("2 roti with dal");
    expect(result.items.map((item: { name: string }) => item.name)).toEqual(["roti", "dal"]);
  });

  it("does not silently ignore explicitly counted sauces when a recipe lists only one", async () => {
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [
      { name: "filled sandwich with 3 sauces", quantity: 1, unit: "30cm", grams: null, uncertainty: null },
    ] });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unmatched", uncertainty: "No exact match" });
    vi.mocked(interpretRecipe).mockResolvedValue({ ok: true, name: "filled sandwich", grams: 450,
      ingredients: [{ name: "bread", grams: 200 }, { name: "filling", grams: 220 }, { name: "mint chutney", grams: 30 }],
      assumptions: ["One sauce estimated"], uncertainty: "Recipe inferred" });
    vi.mocked(estimateWholeDish).mockResolvedValue({ name: "filled sandwich", grams: 450,
      nutrients: { kcal: 900, protein: 30, carbs: 100, fat: 42 },
      assumption: "Whole-dish estimate", assumptions: ["Three sauces included approximately"] });
    const result = await (await POST(request("filled sandwich with 3 sauces"))).json();
    expect(result.items[0]).toMatchObject({ source: "estimated", kcal: 900, grams: 450, matchConfidence: "low" });
    expect(result.items[0].assumptions.join(" ")).toContain("Recipe omitted some stated sauces");
  });
});
