import { z } from "zod";
import { normalize } from "./normalize";
import { validateCatalog } from "./validate";
import { emptyUserData, type Basis, type Catalog, type Food, type Nutrition, type Recipe, type UserData } from "./types";

const text = z.string().trim().min(1).max(500);
const finite = z.number().finite().nonnegative().max(100_000_000);
const amount = z.number().finite().positive().max(10000);
const basis = z.enum(["g", "ml", "serving"]);
const nutrients = z.object({ kcal: finite, protein: finite, carbs: finite, fat: finite, fiber: finite.nullable(), sugar: finite.nullable(), sodium: finite.nullable() });
const food = z.object({ id: text.startsWith("user-"), canonicalName: text, normalizedName: text, foodType: z.literal("USER_CUSTOM"),
  source: z.literal("user"), sourceId: text, locale: text, category: text, description: text, basis,
  nutrition: nutrients.nullable(), defaultPortion: text.nullable(), note: text.optional() });
const portion = z.object({ id: text, foodId: text, unit: text, size: text.nullable(), amount, basis, source: text,
  confidence: z.enum(["exact", "high", "medium", "low", "unknown"]), description: text });
const recipe = z.object({ id: text, foodId: text, version: z.number().int().positive(), yieldGrams: amount, servings: amount,
  ingredients: z.array(z.object({ foodId: text, amount, basis, preparation: text })).min(1).max(40), note: text });
const schema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), foods: z.array(food).max(2000),
  aliases: z.array(z.object({ name: text, foodId: text, priority: z.number().int(), source: z.literal("user"), locale: text })).max(5000),
  portions: z.array(portion).max(5000), recipes: z.array(recipe).max(1000),
  mappings: z.array(z.object({ phrase: text, foodId: text, amount: amount.nullable(), basis, unit: text.nullable() })).max(5000) });

export function validateUserData(raw: unknown, catalog: Catalog): UserData {
  const user = schema.parse(raw) as UserData;
  const merged = { ...catalog, foods: [...catalog.foods, ...user.foods], aliases: [...catalog.aliases, ...user.aliases],
    portions: [...catalog.portions, ...user.portions], recipes: [...catalog.recipes, ...user.recipes] };
  const report = validateCatalog(merged);
  const ids = new Set(merged.foods.map((f) => f.id)), owned = new Set(user.foods.map((f) => f.id));
  if (user.aliases.some((a) => !owned.has(a.foodId) || a.priority !== 200) || user.portions.some((p) => !owned.has(p.foodId)) || user.recipes.some((r) => !owned.has(r.foodId))) report.errors.push("Custom definitions must reference owned foods");
  if (user.mappings.some((m) => !ids.has(m.foodId) || normalize(m.phrase) !== m.phrase)) report.errors.push("Invalid remembered mapping");
  if (new Set(user.mappings.map((m) => m.phrase)).size !== user.mappings.length) report.errors.push("Duplicate mapping");
  if (report.errors.length) throw new Error(report.errors.join("; "));
  return user;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export class UserLibrary {
  readonly key: string;
  constructor(private readonly storage: Storage, owner: string, private readonly catalog: Catalog) {
    this.key = `mealio-food-library-v1:${owner}`;
  }
  load(): UserData {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return emptyUserData();
    try { return validateUserData(JSON.parse(raw), this.catalog); }
    catch { throw new Error("Saved food library could not be read. Export a backup before resetting it."); }
  }
  save(next: UserData): UserData {
    const clean = validateUserData(next, this.catalog);
    clean.revision = this.load().revision + 1;
    // Storage errors propagate so the UI never claims a correction was saved.
    this.storage.setItem(this.key, JSON.stringify(clean));
    return clean;
  }
  export(): string { return this.storage.getItem(this.key) ?? JSON.stringify(emptyUserData()); }
  import(json: string): UserData {
    if (json.length > 5_000_000) throw new Error("Food library file is too large");
    return this.save(validateUserData(JSON.parse(json), this.catalog));
  }
  reset() { this.storage.removeItem(this.key); }
}

function customBase(user: UserData, name: string): Food {
  const canonicalName = text.parse(name), normalizedName = normalize(canonicalName);
  if (user.foods.some((f) => f.normalizedName === normalizedName)) throw new Error("A saved food with this name already exists");
  const id = `user-${user.revision + 1}-${normalizedName.replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
  return { id, canonicalName, normalizedName, foodType: "USER_CUSTOM", source: "user", sourceId: id,
    locale: "en-IN", category: "user", description: "Owner-defined nutrition", basis: "g", nutrition: null, defaultPortion: `${id}-serving` };
}
function addFood(user: UserData, entry: Food, aliases: string[], servingUnit: string, servingAmount: number): UserData {
  const next = structuredClone(user);
  next.foods.push(entry);
  next.aliases.push(...[...new Set([entry.canonicalName, ...aliases].map(normalize).filter(Boolean))].map((name) => ({ name, foodId: entry.id, priority: 200, source: "user", locale: "en-IN" })));
  next.portions.push({ id: entry.defaultPortion!, foodId: entry.id, unit: servingUnit, size: null, amount: servingAmount, basis: entry.basis,
    source: "Your defined serving", confidence: "exact", description: `Your ${servingUnit}` });
  return next;
}

export function customFood(user: UserData, input: { name: string; aliases: string[]; servingAmount: number; unit: string; nutrition: Nutrition }): UserData {
  amount.parse(input.servingAmount); nutrients.parse(input.nutrition);
  const entry = customBase(user, input.name);
  const unit = normalize(input.unit);
  if (!["g", "ml", "piece", "slice", "bowl", "plate", "glass", "cup", "spoon", "teaspoon", "tablespoon", "packet", "bag", "can", "serving"].includes(unit)) throw new Error("Choose a supported serving unit");
  entry.basis = unit === "g" || unit === "ml" ? unit : "serving";
  // Count-only custom foods never acquire an invented weight/density.
  entry.nutrition = Object.fromEntries(Object.entries(input.nutrition).map(([k, v]) => [k, v === null ? null : v * 100 / input.servingAmount])) as Nutrition;
  return addFood(user, entry, input.aliases, unit, entry.basis === "serving" ? 1 : input.servingAmount);
}

export function customRecipe(user: UserData, input: { name: string; aliases: string[]; yieldGrams: number; servings: number;
  unit: string; ingredients: Recipe["ingredients"] }): UserData {
  amount.parse(input.yieldGrams); amount.parse(input.servings);
  const entry = customBase(user, input.name);
  const next = addFood(user, entry, input.aliases, input.unit, input.yieldGrams / input.servings);
  next.recipes.push({ id: entry.id, foodId: entry.id, version: 1, yieldGrams: input.yieldGrams, servings: input.servings,
    ingredients: input.ingredients, note: "Your saved recipe and cooked yield; ingredients are summed without rounding." });
  return next;
}

export function rememberMapping(user: UserData, phrase: string, foodId: string, amount: number | null, basis: Basis, unit: string | null): UserData {
  const next = structuredClone(user), key = normalize(phrase);
  next.mappings = [...next.mappings.filter((m) => m.phrase !== key), { phrase: key, foodId, amount, basis, unit }];
  return next;
}

export function removeCustomFood(user: UserData, id: string): UserData {
  if (user.recipes.some((r) => r.foodId !== id && r.ingredients.some((i) => i.foodId === id))) throw new Error("This food is used by a saved recipe; remove that recipe first");
  return { ...user, foods: user.foods.filter((f) => f.id !== id), aliases: user.aliases.filter((a) => a.foodId !== id),
    portions: user.portions.filter((p) => p.foodId !== id), recipes: user.recipes.filter((r) => r.foodId !== id), mappings: user.mappings.filter((m) => m.foodId !== id) };
}
