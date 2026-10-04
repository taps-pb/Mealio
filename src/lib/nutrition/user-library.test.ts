import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customFood, customRecipe, rememberMapping, removeCustomFood, UserLibrary, validateUserData } from "./user-library";
import { createNutritionEngine, foodCatalog } from "./runtime";
import { emptyUserData } from "./types";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const biscuit = { name: "Jimmy Jam", aliases: ["jimmy jam", "my biscuit"], servingAmount: 1, unit: "piece",
  nutrition: { kcal: 42, protein: .5, carbs: 7, fat: 1.3, fiber: null, sugar: null, sodium: null } };
beforeEach(() => vi.stubGlobal("fetch", () => { throw new Error("Offline"); }));
afterEach(() => vi.unstubAllGlobals());

describe("persistent offline owner library", () => {
  it("learns an unknown count-only food and restores it after restart without inventing grams", () => {
    const storage = memoryStorage(); const library = new UserLibrary(storage, "test-owner", foodCatalog);
    expect(createNutritionEngine().estimate("10 pieces Jimmy Jam").totals).toBeNull();
    library.save(customFood(library.load(), biscuit));
    const restored = new UserLibrary(storage, "test-owner", foodCatalog).load();
    const learned = createNutritionEngine(restored).estimate("10 pieces Jimmy Jam");
    expect(learned.totals!.kcal).toBe(420); expect(learned.items[0].confidence).toBe("exact");
    expect(learned.items[0].portion).toMatchObject({ basis: "serving", amount: 10 });
    expect(createNutritionEngine(restored).estimate("100 g Jimmy Jam").totals).toBeNull();
    expect(new UserLibrary(storage, "another-owner", foodCatalog).load().foods).toEqual([]);
  });
  it("scales nutrient definitions for multiple pieces and measured amounts correctly", () => {
    const two = customFood(emptyUserData(), { ...biscuit, servingAmount: 2 });
    expect(createNutritionEngine(two).estimate("10 pieces Jimmy Jam").totals!.kcal).toBe(210);
    const grams = customFood(emptyUserData(), { ...biscuit, unit: "g", servingAmount: 20 });
    expect(createNutritionEngine(grams).estimate("40g Jimmy Jam").totals!.kcal).toBe(84);
  });
  it("allows explicitly taught aliases to override otherwise ambiguous food and price phrases", () => {
    const taught = customFood(emptyUserData(), { ...biscuit, aliases: ["Snacks", "Dairy milk 26 rupees"] });
    for (const phrase of ["Snacks", "Dairy milk 26 rupees"]) {
      expect(createNutritionEngine().estimate(phrase).totals).toBeNull();
      expect(createNutritionEngine(taught).estimate(phrase).totals!.kcal).toBe(42);
      expect(createNutritionEngine(taught).estimate(phrase).items[0].confidence).toBe("exact");
    }
  });
  it("remembers price mapping only after explicit selection and supports removal/reset", () => {
    const library = new UserLibrary(memoryStorage(), "owner", foodCatalog);
    const phrase = "Dairy milk 26 rupees";
    const saved = library.save(rememberMapping(library.load(), phrase, "off-7622201149406", 20, "g", null));
    const resolved = createNutritionEngine(saved).estimate(phrase);
    expect(resolved.items[0]).toMatchObject({ method: "user_correction", confidence: "exact", portion: { amount: 20, basis: "g" } });
    expect(resolved.totals!.kcal).toBeCloseTo(534 * .2, 10);
    expect(createNutritionEngine(saved).estimate("Dairy milk 30 rupees").totals).toBeNull();
    library.save({ ...saved, mappings: [] });
    expect(createNutritionEngine(library.load()).estimate(phrase).totals).toBeNull();
    library.reset(); expect(library.load()).toEqual(emptyUserData());
  });
  it("lets explicit corrected portions win and scales taught food-unit portions only for the same unit", () => {
    const user = rememberMapping(emptyUserData(), "paneer curry", "recipe-paneer-curry", 175, "g", "bowl");
    const engine = createNutritionEngine(user);
    expect(engine.estimate("2 bowl paneer curry").items[0].portion?.amount).toBe(350);
    expect(engine.estimate("100g paneer curry").items[0].portion?.amount).toBe(100);
    expect(engine.estimate("2 plate paneer curry").totals).toBeNull();
    const corrected = rememberMapping(user, "100 g paneer curry", "recipe-paneer-curry", 150, "g", "g");
    expect(createNutritionEngine(corrected).estimate("100g paneer curry").items[0].portion?.amount).toBe(150);
  });
  it("calculates and persists custom recipes, owner aliases outrank public aliases", () => {
    const library = new UserLibrary(memoryStorage(), "owner", foodCatalog);
    const input = { name: "Mom's Paneer Curry", aliases: ["mom paneer", "usual paneer curry", "paneer curry"], yieldGrams: 200, servings: 2, unit: "bowl",
      ingredients: [{ foodId: "usda-2705740", amount: 100, basis: "g" as const, preparation: "paneer" },
        { foodId: "usda-170457", amount: 100, basis: "g" as const, preparation: "tomato" }] };
    const saved = library.save(customRecipe(library.load(), input));
    const engine = createNutritionEngine(library.load());
    const result = engine.estimate("1 bowl mom paneer");
    expect(result.items[0].canonicalName).toBe(input.name);
    expect(result.items[0].portion?.amount).toBe(100);
    expect(result.totals!.kcal).toBeCloseTo((engine.catalog.nutrition("usda-2705740")!.kcal + engine.catalog.nutrition("usda-170457")!.kcal) / 2, 10);
    expect(engine.estimate("paneer curry").items[0].canonicalFoodId).toBe(saved.foods[0].id);
    const exported = library.export();
    const second = new UserLibrary(memoryStorage(), "owner", foodCatalog);
    second.import(exported); expect(createNutritionEngine(second.load()).estimate("1 bowl mom paneer").totals).toEqual(result.totals);
  });
  it("invalidates per-engine caches after correction updates and dataset changes", () => {
    const library = new UserLibrary(memoryStorage(), "owner", foodCatalog);
    const before = createNutritionEngine(library.load());
    before.estimate("10 pieces Jimmy Jam");
    const first = library.save(customFood(library.load(), biscuit));
    expect(first.revision).toBe(1);
    const next = structuredClone(first); next.foods[0].nutrition!.kcal = 5000;
    const second = library.save(next); expect(second.revision).toBe(2);
    expect(createNutritionEngine(first).estimate("Jimmy Jam").totals!.kcal).toBe(42);
    expect(createNutritionEngine(second).estimate("Jimmy Jam").totals!.kcal).toBe(50);
    expect(before.estimate("Jimmy Jam").totals).toBeNull();
  });
  it("rejects corrupt imports, bad references, cycles, invalid nutrition and storage failures atomically", () => {
    const storage = memoryStorage(), library = new UserLibrary(storage, "owner", foodCatalog);
    library.save(customFood(library.load(), biscuit)); const original = library.export();
    expect(() => library.import('{"schemaVersion":8}')).toThrow(); expect(library.export()).toBe(original);
    const broken = library.load(); broken.mappings.push({ phrase: "bad", foodId: "missing", amount: 1, basis: "g", unit: null });
    expect(() => library.save(broken)).toThrow(); expect(library.export()).toBe(original);
    expect(() => customFood(emptyUserData(), { ...biscuit, nutrition: { ...biscuit.nutrition, kcal: -1 } })).toThrow();
    expect(() => customFood(emptyUserData(), { ...biscuit, servingAmount: 0 })).toThrow();
    expect(() => validateUserData({ ...emptyUserData(), foods: [foodCatalog.foods[0]] }, foodCatalog)).toThrow();
    storage.setItem(library.key, "corrupt"); expect(() => library.load()).toThrow(); expect(library.export()).toBe("corrupt");
    const full = new UserLibrary({ ...memoryStorage(), setItem: () => { throw new Error("Quota exceeded"); } }, "owner", foodCatalog);
    expect(() => full.save(customFood(emptyUserData(), biscuit))).toThrow("Quota exceeded");
  });
  it("refuses to remove a custom ingredient while a saved recipe depends on it", () => {
    const food = customFood(emptyUserData(), biscuit);
    const recipe = customRecipe(food, { name: "My dessert", aliases: [], yieldGrams: 100, servings: 1, unit: "bowl",
      ingredients: [{ foodId: food.foods[0].id, amount: 3, basis: "serving", preparation: "3 biscuits" }] });
    expect(() => removeCustomFood(recipe, food.foods[0].id)).toThrow("used by a saved recipe");
    const remaining = removeCustomFood(recipe, recipe.foods[1].id);
    expect(removeCustomFood(remaining, food.foods[0].id).foods).toEqual([]);
  });
});
