import { FoodCatalog } from "./catalog";
import type { Catalog } from "./types";

export function validateCatalog(data: Catalog): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const ids = new Set(data.foods.map((f) => f.id)), sources = new Set(data.sources.map((s) => s.id));
  if (ids.size !== data.foods.length) errors.push("Duplicate canonical ID");
  if (sources.size !== data.sources.length) errors.push("Duplicate source ID");
  if (new Set(data.recipes.map((r) => r.foodId)).size !== data.recipes.length) errors.push("Multiple recipe definitions for one food");
  if (new Set(data.portions.map((p) => p.id)).size !== data.portions.length) errors.push("Duplicate portion ID");
  for (const food of data.foods) {
    if (!sources.has(food.source) && food.source !== "user") errors.push(`${food.id}: invalid source`);
    if (!food.sourceId || !food.canonicalName) errors.push(`${food.id}: missing identity`);
    if (!["g", "ml", "serving"].includes(food.basis)) errors.push(`${food.id}: invalid nutrition basis`);
    if (food.restaurant && food.foodType !== "RESTAURANT_ITEM") errors.push(`${food.id}: invalid restaurant type`);
    if (food.variant && !food.restaurant) errors.push(`${food.id}: orphan variant`);
    if (food.density && (!Number.isFinite(food.density.gramsPerMl) || food.density.gramsPerMl <= 0)) errors.push(`${food.id}: invalid density`);
    if (food.defaultPortion && !data.portions.some((p) => p.id === food.defaultPortion && p.foodId === food.id)) errors.push(`${food.id}: missing default serving`);
    if (food.nutrition) {
      const n = food.nutrition;
      if (Object.values(n).some((v) => v !== null && (!Number.isFinite(v) || v < 0))) errors.push(`${food.id}: invalid nutrient`);
      const derived = 4 * (n.protein + n.carbs) + 9 * n.fat;
      if (Math.abs(derived - n.kcal) > Math.max(30, n.kcal * .25)) warnings.push(`${food.id}: macro energy discrepancy`);
      if (food.basis === "g" && (n.protein + n.carbs + n.fat > 110 || n.kcal > 950)) errors.push(`${food.id}: implausible mass/energy`);
    }
  }
  for (const alias of data.aliases) if (!ids.has(alias.foodId) || !alias.name.trim()) errors.push("Broken alias");
  for (const portion of data.portions) if (!ids.has(portion.foodId) || !Number.isFinite(portion.amount) || portion.amount <= 0 || portion.amount > 10000 || !["g", "ml", "serving"].includes(portion.basis)) errors.push(`${portion.id}: invalid portion`);
  for (const recipe of data.recipes) {
    if (!ids.has(recipe.foodId) || !Number.isFinite(recipe.yieldGrams) || recipe.yieldGrams <= 0 || recipe.yieldGrams > 100000 || !Number.isFinite(recipe.servings) || recipe.servings <= 0 || !recipe.ingredients.length) errors.push(`${recipe.id}: invalid yield/servings`);
    for (const ingredient of recipe.ingredients) if (!ids.has(ingredient.foodId) || !Number.isFinite(ingredient.amount) || ingredient.amount <= 0 || ingredient.amount > 10000 || !["g", "ml", "serving"].includes(ingredient.basis)) errors.push(`${recipe.id}: invalid ingredient`);
  }
  if (!errors.length) {
    try { const catalog = new FoodCatalog(data); for (const recipe of data.recipes) catalog.nutrition(recipe.foodId); }
    catch (cause) { errors.push(cause instanceof Error ? cause.message : "Invalid recipe graph"); }
  }
  return { errors, warnings };
}
