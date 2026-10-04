import { scaleNutrition, sumNutrition } from "./calculate";
import { gramsOfText, normalize } from "./normalize";
import type { Basis, Catalog, Candidate, Food, Nutrition, Portion, Recipe, Source } from "./types";

export class FoodCatalog {
  readonly foods: Map<string, Food>;
  readonly portions = new Map<string, Portion[]>();
  readonly recipes: Map<string, Recipe>;
  readonly sources: Map<string, Source>;
  readonly compoundPhrases: string[];
  readonly exact = new Map<string, { foodId: string; priority: number; method: string }[]>();
  private readonly postings = new Map<string, Set<string>>();
  private readonly names = new Map<string, Set<string>>();
  private readonly nutritionCache = new Map<string, Nutrition | null>();
  constructor(readonly data: Catalog) {
    this.foods = new Map(data.foods.map((food) => [food.id, food]));
    this.recipes = new Map(data.recipes.map((recipe) => [recipe.foodId, recipe]));
    this.sources = new Map(data.sources.map((source) => [source.id, source]));
    this.compoundPhrases = data.aliases.map((alias) => alias.name).filter((name) => /\band\b|&/.test(name));
    for (const portion of data.portions) this.portions.set(portion.foodId, [...(this.portions.get(portion.foodId) ?? []), portion]);
    const add = (name: string, foodId: string, priority: number, method: string) => {
      const key = normalize(name);
      this.exact.set(key, [...(this.exact.get(key) ?? []), { foodId, priority, method }]);
      const names = this.names.get(foodId) ?? new Set<string>(); names.add(key); this.names.set(foodId, names);
      for (const gram of gramsOfText(key)) { const ids = this.postings.get(gram) ?? new Set<string>(); ids.add(foodId); this.postings.set(gram, ids); }
    };
    for (const food of data.foods) {
      add(food.canonicalName, food.id, food.foodType === "USER_CUSTOM" ? 200 : 90, "canonical");
      if (food.barcode) add(food.barcode, food.id, 120, "barcode");
    }
    for (const alias of data.aliases) add(alias.name, alias.foodId, alias.priority, "alias");
  }

  nutrition(id: string, visiting = new Set<string>()): Nutrition | null {
    if (this.nutritionCache.has(id)) return this.nutritionCache.get(id)!;
    const food = this.foods.get(id);
    if (!food) throw new Error(`Missing food ${id}`);
    const recipe = this.recipes.get(id);
    let value = food.nutrition;
    if (recipe) {
      if (visiting.has(id)) throw new Error("Recipe cycle");
      const next = new Set(visiting); next.add(id);
      const ingredients = recipe.ingredients.map((ingredient) => {
        const nutrient = this.nutrition(ingredient.foodId, next);
        const sourceFood = this.foods.get(ingredient.foodId)!;
        const amount = convertAmount(sourceFood, ingredient.amount, ingredient.basis);
        return nutrient && amount !== null ? scaleNutrition(nutrient, amount) : null;
      });
      value = ingredients.every((entry) => entry !== null)
        ? scaleNutrition(sumNutrition(ingredients as Nutrition[]), 10000 / recipe.yieldGrams) : null;
    }
    this.nutritionCache.set(id, value);
    return value;
  }

  search(query: string, limit = 6): Candidate[] {
    const key = normalize(query); if (!key) return [];
    const hits = new Map<string, number>();
    for (const gram of gramsOfText(key)) for (const id of this.postings.get(gram) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
    // Score a bounded posting-list shortlist rather than scanning every record.
    return [...hits].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 80).map(([id]) => {
      const food = this.foods.get(id)!;
      const score = Math.max(...[...this.names.get(id)!].map((name) => similarity(key, name)));
      return { foodId: id, name: food.canonicalName, source: food.source, score };
    }).filter((c) => c.score >= .32).sort((a, b) => b.score - a.score || a.foodId.localeCompare(b.foodId)).slice(0, limit);
  }
}

export function convertAmount(food: Food, amount: number, from: Basis): number | null {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return null;
  if (food.basis === from) return amount;
  if (food.basis === "serving" || from === "serving") return null;
  const density = food.density?.gramsPerMl;
  if (!density || !Number.isFinite(density) || density <= 0) return null;
  const result = from === "ml" ? amount * density : amount / density;
  return Number.isFinite(result) && result > 0 && result <= 100000 ? result : null;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]; previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  const edit = 1 - previous[b.length] / Math.max(a.length, b.length);
  const words = new Set(a.split(" ")), other = new Set(b.split(" "));
  const overlap = [...words].filter((word) => other.has(word)).length / Math.max(words.size, other.size);
  return Math.max(edit, overlap * .95);
}
