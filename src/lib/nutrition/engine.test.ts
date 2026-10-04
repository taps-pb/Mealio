import http from "node:http";
import https from "node:https";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNutritionEngine, foodCatalog } from "./runtime";
import { NutritionEngine } from "./engine";
import { realFoodCorpus } from "./corpus";
import { scaleNutrition } from "./calculate";
import { validateCatalog } from "./validate";
import { emptyUserData } from "./types";
import { toSnapshots } from "./snapshots";
import { mealInputSchema } from "@/server/meals/validation";

const network = vi.fn(() => { throw new Error("NO NETWORK allowed in estimator"); });
beforeEach(() => {
  network.mockClear();
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) vi.stubGlobal(name, network);
  vi.spyOn(http, "request").mockImplementation(network); vi.spyOn(http, "get").mockImplementation(network);
  vi.spyOn(https, "request").mockImplementation(network); vi.spyOn(https, "get").mockImplementation(network);
  vi.spyOn(net, "connect").mockImplementation(network);
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("local deterministic resolution (all networking disabled)", () => {
  // Ground truth here is interpretation and source identity, never old AI calories.
  const identities = [
    ["recipe-kheer"], ["recipe-aloo-pyaaz-paratha", "usda-2709458", "recipe-sweet-lassi"],
    ["usda-2708346", "usda-2707430", "usda-2709458", "recipe-cold-coffee", "usda-2709910", "usda-2707841"],
    ["usda-2708616", "recipe-oreo-milkshake"], ["off-8901491435109"], ["label-sprite-india"], [null], ["off-8901764022272"],
    ["off-8901499010773", "recipe-butterscotch-milkshake", "usda-2708346", "usda-2707430", "recipe-poha"],
    ["recipe-sweet-lassi"], ["recipe-aloo-pyaaz-paratha"], ["off-8901499010773"], ["usda-2708730", "recipe-rajma-chawal"],
    ["recipe-rajma-chawal"], ["off-8901499010773", "usda-2705385"], ["usda-171688"],
    ["subway-paneer-30", "subway-crispers", null, "subway-double-cookie"], ["recipe-kaju-katli", "off-8901058901511", null],
    ["recipe-rooh-afza-milk", "usda-2707599"], [null], ["recipe-khichdi"], [null], ["usda-169097"],
    ["usda-2708985", "recipe-kaju-katli"], ["usda-2707713", "recipe-paneer-curry"],
  ];
  it.each(realFoodCorpus.map((text, i) => [text, identities[i]] as const))("resolves or honestly clarifies: %s", (text, ids) => {
    const result = createNutritionEngine().estimate(text);
    expect(result.items.map((i) => i.canonicalFoodId)).toEqual(ids);
    for (const item of result.items) {
      expect(item.parsed.rawText).not.toBe("");
      if (item.status === "resolved") {
        expect(item.nutrition!.kcal).toBeGreaterThanOrEqual(0);
        expect(item.portion!.amount).toBeGreaterThan(0);
        expect(item.source?.id).toBeTruthy();
      } else expect(item.nutrition).toBeNull();
    }
    expect(result.totals === null).toBe(result.incomplete);
  });
  it.each(["apple", "rajma chawal", "idli", "alu parantha", "aloo pyaz paratha", "kher", "lassai"])("resolves local exact/alias %s", (text) => {
    expect(createNutritionEngine().estimate(text).incomplete).toBe(false);
  });
  it("scales only once, including half plates and food-specific bowls", () => {
    const engine = createNutritionEngine();
    const once = engine.estimate("1 aloo pyaaz paratha");
    expect(engine.estimate("2 aloo pyaaz paratha").totals!.kcal).toBe(once.totals!.kcal * 2);
    expect(engine.estimate("2 plate rajma chawal").items[0].portion?.amount).toBe(700);
    expect(engine.estimate("1 half plate vegetable biryani").items[0].portion?.amount).toBe(150);
    expect(engine.estimate("half small bowl sambar").items[0].portion?.amount).toBe(60);
    const bowls = ["Chocos", "kheer", "paneer curry", "sambar"].map((food) => engine.estimate(`1 bowl ${food}`).items[0].portion?.amount);
    expect(new Set(bowls).size).toBe(4);
  });
  it("resolves barcodes and conservative fuzzy candidates without crossing brand identities", () => {
    const engine = createNutritionEngine();
    expect(engine.estimate("30g 8901499010773").items[0]).toMatchObject({ method: "barcode", confidence: "exact", canonicalFoodId: "off-8901499010773" });
    expect(engine.estimate("100 g whol wheat flour").items[0]).toMatchObject({ method: "fuzzy", confidence: "medium", canonicalFoodId: "usda-168893" });
    expect(engine.estimate("100 g whole wheat flour").items[0].method).toBe("alias");
    for (const text of ["180 ml Sprite Zero", "Subway apple", "100 g unknownbrand wheat flour"]) expect(engine.estimate(text).totals, text).toBeNull();
    expect(engine.catalog.search("cornitos").some((c) => c.name.toLowerCase().includes("cornitos"))).toBe(true);
  });
  it("uses labeled volume, keeps milk density explicit, and never equates ml to g", () => {
    const engine = createNutritionEngine();
    expect(engine.estimate("180 ml Sprite").totals!.kcal).toBeCloseTo(49 * 1.8, 10);
    expect(engine.estimate("180 ml Fanta").totals!.kcal).toBeCloseTo(52 * 1.8, 10);
    const meal = engine.estimate("30 g Chocos + 200 ml milk");
    expect(meal.items).toHaveLength(2);
    expect(meal.items[0].nutrition!.kcal).toBeCloseTo(390 * .3, 10);
    expect(meal.items[1].portion!.amount).toBeCloseTo(200 * 244 / 240, 10);
    expect(engine.estimate("200 ml apple").totals).toBeNull();
    expect(engine.estimate("200 g Sprite").totals).toBeNull();
    expect(engine.estimate("0.1 kg apple").totals).toEqual(engine.estimate("100 g apple").totals);
    expect(engine.estimate("0.2 liter milk").totals).toEqual(engine.estimate("200 ml milk").totals);
  });
  it("keeps restaurant sizes and whole pizza separate from grams/slices", () => {
    const engine = createNutritionEngine();
    const six = engine.estimate("15cm paneer tikka subway"), twelve = engine.estimate("30cm paneer tikka subway sandwich");
    expect(six.items[0].portion?.amount).toBe(274); expect(twelve.items[0].portion?.amount).toBe(548);
    expect(twelve.totals!.kcal).toBeCloseTo(six.totals!.kcal * 2, 10);
    expect(engine.estimate("subway paneer tikka").totals).toBeNull();
    expect(engine.estimate("1 medium margarita pizza").items[0].portion?.amount).toBe(691);
    expect(engine.estimate("1 slice margarita pizza").items[0].portion?.amount).toBe(86);
  });
  it("never invents ambiguous identities, packages, price weights or bad label nutrients", () => {
    for (const text of ["Snacks", "Dairy milk 26 rupees", "Dairy Milk", "Jimmy jam", "Cornitos small bag", "some completely unknown food xyz", "2 plate maggi", "1 bowl french fries", "9999 kg apple"]) {
      const estimate = createNutritionEngine().estimate(text);
      expect(estimate.incomplete, text).toBe(true); expect(estimate.totals, text).toBeNull();
    }
  });
  it("uses explicitly reviewed label evidence instead of a corrupt product API profile", () => {
    const engine = createNutritionEngine();
    const chips = engine.estimate("26.5 gram green uncle chips");
    expect(chips.totals!.kcal).toBeCloseTo(536 * .265, 10);
    expect(chips.totals!.protein).toBeCloseTo(6.8 * .265, 10);
    expect(chips.items[0].warnings.join(" ")).toContain("Reviewed package label");
    const biscuit = engine.estimate("10 pieces Britannia Jim Jam");
    expect(biscuit.items[0].portion!.amount).toBe(125);
    expect(biscuit.totals!.kcal).toBeCloseTo(483 * 1.25, 10);
  });
  it("calculates actual recipe variants and flags unmodeled modifiers without arbitrary adjustment", () => {
    const engine = createNutritionEngine();
    const ordinary = engine.estimate("aloo pyaaz paratha");
    const lower = engine.estimate("aloo pyaaz paratha little oil");
    expect(lower.items[0].recipe?.ingredients.find((i) => i.foodId === "usda-172336")?.amount).toBe(3);
    const oil = engine.catalog.nutrition("usda-172336")!;
    expect(ordinary.totals!.kcal - lower.totals!.kcal).toBeCloseTo(oil.kcal * .03, 10);
    const unknown = engine.estimate("aloo pyaaz paratha extra oil");
    expect(unknown.items[0].confidence).toBe("low");
    expect(unknown.items[0].warnings.join(" ")).toContain("No defined adjustment");
    expect(unknown.totals).toEqual(ordinary.totals);
  });
  it("is repeatable across new instances, cache hits and caller mutation", () => {
    const engine = createNutritionEngine();
    for (const text of realFoodCorpus) {
      const first = engine.estimate(text), repeated = engine.estimate(text);
      expect(repeated).toEqual(first); expect(createNutritionEngine().estimate(text)).toEqual(first);
      first.items[0].warnings.push("caller mutation");
      if (first.items[0].per100) first.items[0].per100.kcal += 9000;
      if (first.items[0].recipe) first.items[0].recipe.yieldGrams += 9000;
      expect(engine.estimate(text)).toEqual(repeated);
      expect(createNutritionEngine().estimate(text)).toEqual(repeated);
    }
  });
  it("validates all records and catches broken IDs, variants, quantities and recipe cycles", () => {
    expect(validateCatalog(foodCatalog).errors).toEqual([]);
    const broken = structuredClone(foodCatalog);
    broken.foods.push(broken.foods[0]); broken.portions[0].amount = Number.NaN;
    broken.aliases[0].foodId = "does-not-exist"; broken.recipes[0].ingredients[0].foodId = "missing";
    expect(validateCatalog(broken).errors.length).toBeGreaterThanOrEqual(4);
    const cycle = structuredClone(foodCatalog); cycle.recipes[0].ingredients[0].foodId = cycle.recipes[0].foodId;
    expect(validateCatalog(cycle).errors).toContain("Recipe cycle");
    expect(() => scaleNutrition(engineNutrition(), Infinity)).toThrow();
    expect(() => scaleNutrition(engineNutrition(), NaN)).toThrow();
  });
  it("saves full precision and provenance without rewriting historical snapshots on a dataset update", () => {
    const text = "30 g Chocos + 200 ml milk", estimate = createNutritionEngine().estimate(text);
    const snapshots = toSnapshots(estimate);
    const saved = mealInputSchema.parse({ description: text, eatenAt: "2026-10-04T01:00:00+05:30", itemSnapshots: snapshots,
      kcal: 241.03, protein: 9.11, carbs: 34.94, provenance: "corrected", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" });
    expect(saved.itemSnapshots).toEqual(snapshots);
    const historical = JSON.stringify(saved);
    const newer = structuredClone(foodCatalog); newer.version = "next";
    newer.foods.find((f) => f.id === "usda-2705385")!.nutrition!.kcal += 50;
    expect(new NutritionEngine(newer, emptyUserData()).estimate(text).totals).not.toEqual(estimate.totals);
    expect(JSON.stringify(saved)).toBe(historical);
    expect(saved.itemSnapshots[0].local?.rawText).toBe("30 g Chocos");
  });
});
function engineNutrition() { return createNutritionEngine().catalog.nutrition("usda-171688")!; }
