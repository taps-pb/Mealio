import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { normalize } from "../src/lib/nutrition/normalize";
import { validateCatalog } from "../src/lib/nutrition/validate";
import type { Catalog, Food, Nutrition, Source } from "../src/lib/nutrition/types";

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const selection = read<{ retrieved: string; off: Record<string, { aliases: string[]; basis: "g" | "ml"; note?: string }> }>("data/selection.json");
const usda = read<{ sources: Source[]; records: { id: string; sourceId: string; source: string; description: string; aliases: string[];
  nutrition: Nutrition; category: string; portions: { name: string; grams: number; quantity: number }[] }[] }>("data/normalized/usda.json");
const off = read<{ source: Source; products: { code: string; product_name: string; brands: string; quantity: string; serving_size: string;
  countries_tags: string[]; nutrition_data_per: string; nutriments: Record<string, number>; last_modified_t: number }[] }>("data/normalized/openfoodfacts.json");
const recipes = read<{ note: string; recipes: { id: string; name: string; aliases: string[]; yieldGrams: number; servings: number;
  portion: [string, number]; ingredients: [string, number, "g" | "ml", string][] }[] }>("data/recipes.json");
const restaurant = read<{ source: Source; note: string; items: { id: string; name: string; variant?: string; grams: number; kcal: number;
  protein: number; carbs: number; fat: number; sugar: number; sodium: number; aliases: string[]; page: number; note?: string }[] }>("data/restaurant-facts.json");
const curated = readFileSync("data/recipes.json");
const reviews = read<{ version: number; retrieved: string; records: { barcode: string; url: string; sha256: string; rawBytes: number; basis: "g" | "ml"; nutrition: Nutrition; pieceGrams?: number; reason: string }[] }>("data/reviewed-labels.json");
const reviewByBarcode = new Map(reviews.records.map((review) => [review.barcode, review]));
off.source = { ...off.source, version: `${off.source.version}; reviewed labels v${reviews.version}` };
const manufacturer = read<{ source: Source; items: { id: string; name: string; brand: string; basis: "g" | "ml"; nutrition: Nutrition; aliases: string[]; note: string }[] }>("data/manufacturer-facts.json");
const data: Catalog = { version: "", sources: [...usda.sources, off.source, restaurant.source, manufacturer.source, {
  id: "mealio", name: "Mealio defined recipes and portions", version: "1", url: "https://github.com/taps-pb/Mealio/tree/main/data",
  license: "CC0-1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", retrieved: selection.retrieved,
  transformation: "scripts/build-food-db.ts", recordsImported: recipes.recipes.length, sha256: hash(curated), rawBytes: curated.length,
}], foods: [], aliases: [], portions: [], recipes: [] };
const warnings: string[] = [];
function add(food: Food, aliases: string[], priority = 100) {
  data.foods.push(food);
  for (const name of new Set(aliases.map(normalize))) data.aliases.push({ name, foodId: food.id, priority, source: food.source, locale: food.locale });
}
function portion(id: string, unit: string, amount: number, size: string | null = null, source = "Mealio defined portion; review", isDefault = false) {
  const food = data.foods.find((f) => f.id === id); if (!food) throw new Error(`Missing portion food ${id}`);
  const key = `${id}-${unit}-${size ?? "default"}`;
  data.portions.push({ id: key, foodId: id, unit, size, amount, basis: food.basis, source, confidence: "medium", description: `${size ?? "standard"} ${unit}` });
  if (isDefault) food.defaultPortion = key;
}
for (const record of usda.records) {
  add({ id: record.id, canonicalName: record.aliases[0], normalizedName: normalize(record.aliases[0]),
    foodType: ["idli", "sambar", "roti", "samosa", "vegetable biryani"].includes(record.aliases[0]) ? "INDIAN_PREPARED_DISH"
      : ["whole wheat flour", "sugar", "onion", "cashews", "tomato", "cumin seeds", "canola oil", "boiled potato", "cooked lentils", "cooked kidney beans", "dry rice", "unsalted butter", "water", "paneer"].includes(record.aliases[0]) ? "INGREDIENT" : "GENERIC_FOOD",
    source: record.source, sourceId: record.sourceId, category: record.category, description: record.description, locale: "en",
    basis: "g", nutrition: record.nutrition, defaultPortion: null,
    servingDescription: record.portions.map((p) => `${p.quantity} ${p.name}: ${p.grams} g`).join("; "),
    ...(record.aliases.includes("margherita pizza") ? { note: "USDA medium-crust cheese pizza reference, not a specific restaurant margherita recipe." } : {}),
    ...(record.id === "usda-2709422" ? { note: "Generic plain potato-chip reference; brand and seasoning may differ. Use only when this generic reference is appropriate." } : {}),
  }, [...record.aliases, record.description]);
}
for (const product of off.products) {
  const config = selection.off[product.code]; if (!config) continue;
  const review = reviewByBarcode.get(product.code);
  if (review && review.basis !== config.basis) throw new Error("Reviewed label basis differs from selected product");
  if (product.nutrition_data_per !== `100${config.basis}`) throw new Error(`${product.code}: declared basis differs from selection; review source instead of assuming density`);
  const n = product.nutriments ?? {};
  const nutrient = (key: string) => typeof n[key] === "number" && Number.isFinite(n[key]) && n[key] >= 0 ? n[key] : null;
  const values = { kcal: nutrient("energy-kcal_100g") ?? (nutrient("energy_100g") === null ? null : n.energy_100g / 4.184),
    protein: nutrient("proteins_100g"), carbs: nutrient("carbohydrates_100g"), fat: nutrient("fat_100g"),
    fiber: nutrient("fiber_100g"), sugar: nutrient("sugars_100g"), sodium: nutrient("sodium_100g") === null ? null : n.sodium_100g * 1000 };
  const incomplete = [values.kcal, values.protein, values.carbs, values.fat].some((v) => v === null);
  const impossible = !incomplete && config.basis === "g" && (values.protein! + values.carbs! + values.fat! > 110 || values.kcal! > 950);
  if (incomplete || impossible) warnings.push(`${product.code}: ${incomplete ? "missing nutrients" : "macro mass exceeds 100g"}; ${review ? "explicit reviewed package-label values used" : "retained identity, nutrition quarantined"}`);
  const notes = [config.note, review ? `Reviewed package label (${reviews.retrieved}): ${review.url}. ${review.reason}`
    : incomplete || impossible ? "Source data incomplete or inconsistent; check the package label." : "Open Food Facts label snapshot; verify current product/variant."];
  add({ id: `off-${product.code}`, canonicalName: `${product.brands || ""} ${product.product_name}`.trim(),
    normalizedName: normalize(`${product.brands || ""} ${product.product_name}`), foodType: "PACKAGED_PRODUCT", source: "off",
    sourceId: product.code, locale: "en-IN", category: "packaged", description: product.product_name, brand: product.brands || config.aliases[0],
    barcode: product.code, packageQuantity: product.quantity || "", servingDescription: product.serving_size || "",
    countries: product.countries_tags || [], basis: config.basis, nutrition: review?.nutrition ?? (incomplete || impossible ? null : values as Nutrition),
    defaultPortion: null, note: notes.filter(Boolean).join(" ") }, config.aliases, 110);
  // Package sizes are used only when explicitly requesting a packet, never
  // inferred from a price or the word "small".
  const pack = /^(\d+(?:\.\d+)?)\s*(g|ml)$/i.exec(product.quantity || "");
  if (pack && pack[2].toLowerCase() === config.basis) portion(`off-${product.code}`, "packet", Number(pack[1]), null, "Open Food Facts package quantity");
  if (review?.pieceGrams) portion(`off-${product.code}`, "piece", review.pieceGrams, null, `Reviewed package serving: ${review.url}`, true);
}
for (const entry of manufacturer.items) {
  add({ id: entry.id, canonicalName: entry.name, normalizedName: normalize(entry.name), foodType: "PACKAGED_PRODUCT", brand: entry.brand,
    source: manufacturer.source.id, sourceId: entry.id, locale: "en-IN", category: "packaged", description: entry.name,
    basis: entry.basis, nutrition: entry.nutrition, defaultPortion: null, note: entry.note }, entry.aliases, 130);
}
for (const entry of restaurant.items) {
  const nutrient = { kcal: entry.kcal, protein: entry.protein, carbs: entry.carbs, fat: entry.fat, fiber: null, sugar: entry.sugar, sodium: entry.sodium };
  const per100 = Object.fromEntries(Object.entries(nutrient).map(([k, v]) => [k, v === null ? null : v * 100 / entry.grams])) as Nutrition;
  add({ id: entry.id, canonicalName: entry.name, normalizedName: normalize(entry.name), foodType: "RESTAURANT_ITEM", restaurant: "Subway",
    source: "subway-in", sourceId: `${entry.id}-page-${entry.page}`, locale: "en-IN", category: "restaurant", description: entry.name,
    basis: "g", nutrition: per100, defaultPortion: null, variant: entry.variant, note: [entry.note, restaurant.note].filter(Boolean).join(" ") }, entry.aliases, 115);
  portion(entry.id, "serving", entry.grams, null, "Subway India August 2026 official serving", true);
}
for (const recipe of recipes.recipes) {
  const id = `recipe-${recipe.id}`;
  add({ id, canonicalName: recipe.name, normalizedName: normalize(recipe.name), foodType: "RECIPE", source: "mealio", sourceId: recipe.id,
    locale: "en-IN", category: "prepared", description: recipes.note, basis: "g", nutrition: null, defaultPortion: null }, recipe.aliases, 105);
  data.recipes.push({ id: recipe.id, foodId: id, version: 1, yieldGrams: recipe.yieldGrams, servings: recipe.servings,
    note: recipes.note, ingredients: recipe.ingredients.map(([foodId, amount, basis, preparation]) => ({ foodId, amount, basis, preparation })) });
  portion(id, recipe.portion[0], recipe.portion[1], null, "Mealio defined recipe serving; not a measured household portion", true);
}
// Food-specific household portions, not one bowl/plate constant. Where a value
// is a curated assumption it is explicitly labeled; source measures stay above.
for (const [id, unit, amount, source] of [
  ["usda-171688", "piece", 182, "USDA SR medium apple"], ["usda-169097", "piece", 131, "USDA SR medium orange"],
  ["usda-173944", "piece", 118, "USDA SR medium banana"], ["usda-171287", "piece", 50, "USDA SR large egg"],
  ["usda-173424", "piece", 50, "USDA SR large boiled egg"], ["usda-2708346", "piece", 38, "USDA FNDDS 1 item idli"],
  ["usda-2707713", "piece", 40, "USDA FNDDS medium roti"], ["usda-2708730", "piece", 75, "USDA FNDDS unspecified samosa serving"],
  ["usda-2707841", "piece", 130, "USDA FNDDS medium muffin"], ["usda-2707599", "piece", 24, "Mealio toast slice assumption"],
  ["usda-2708616", "serving", 691, "USDA FNDDS medium whole pizza (11–12 inches)"],
] as const) portion(id, unit, amount, null, source, true);
portion("usda-2708616", "piece", 86, null, "USDA FNDDS piece of medium pizza");
portion("usda-2708616", "slice", 86, null, "USDA FNDDS piece of medium pizza");
portion("usda-2709458", "piece", 9, null, "USDA FNDDS fried wedge", true);
portion("usda-2709458", "plate", 110, null, "USDA FNDDS unspecified fries serving, treated as a plate");
portion("usda-2707430", "bowl", 180, null, undefined, true);
portion("usda-2707430", "bowl", 120, "small");
portion("usda-2707430", "bowl", 250, "large");
portion("usda-2708985", "plate", 300, null, undefined, true);
portion("usda-2709910", "spoon", 20, "large");
portion("usda-2709910", "tablespoon", 10);
portion("off-8901499010773", "bowl", 30, "small");
portion("off-8901499010773", "bowl", 40);
portion("recipe-poha", "spoon", 30, "large");
portion("recipe-kheer", "bowl", 100, "small");
portion("recipe-paneer-curry", "bowl", 125, "small");
portion("recipe-cold-coffee", "glass", 150, "small");
portion("recipe-butterscotch-milkshake", "glass", 150, "small");
portion("recipe-sweet-lassi", "glass", 150, "small");
portion("usda-2707599", "slice", 24);
portion("usda-2705385", "glass", 244);
portion("usda-2705385", "cup", 244);
data.foods.find((f) => f.id === "usda-2705385")!.density = { gramsPerMl: 244 / 240, source: "244 g USDA cup; 240 ml nutrition-label cup convention" };
// Keep modifier-less bare unknown brands ambiguous; candidate search still
// offers their variants without silently choosing one.
data.foods.sort((a, b) => a.id.localeCompare(b.id));
data.aliases.sort((a, b) => a.name.localeCompare(b.name) || a.foodId.localeCompare(b.foodId));
data.portions.sort((a, b) => a.id.localeCompare(b.id));
data.version = `1-${hash(JSON.stringify(data)).slice(0, 16)}`;
const validation = validateCatalog(data);
if (validation.errors.length) throw new Error(validation.errors.join("\n"));
const artifact = JSON.stringify(data);
mkdirSync("public/nutrition", { recursive: true });
writeFileSync("public/nutrition/catalog.json", artifact + "\n");
writeFileSync("public/nutrition/openfoodfacts.json", JSON.stringify({ source: off.source, foods: data.foods.filter((f) => f.source === "off"), aliases: data.aliases.filter((a) => a.source === "off") }) + "\n");
const manifest = { databaseVersion: data.version, generatedAt: `${selection.retrieved}T00:00:00.000Z`, sources: data.sources,
  reviewedLabelEvidence: reviews,
  sourceRuntimeBytes: Object.fromEntries(data.sources.map((source) => [source.id, Buffer.byteLength(JSON.stringify({
    foods: data.foods.filter((food) => food.source === source.id), aliases: data.aliases.filter((alias) => alias.source === source.id),
    portions: data.portions.filter((portion) => data.foods.find((food) => food.id === portion.foodId)?.source === source.id),
    recipes: data.recipes.filter((recipe) => data.foods.find((food) => food.id === recipe.foodId)?.source === source.id),
  }))])),
  counts: { foods: data.foods.length, aliases: data.aliases.length, portions: data.portions.length, recipes: data.recipes.length,
    products: data.foods.filter((f) => f.foodType === "PACKAGED_PRODUCT").length, restaurantItems: restaurant.items.length },
  sizes: { rawSourceBytes: data.sources.reduce((sum, s) => sum + s.rawBytes, 0) + reviews.records.reduce((sum, review) => sum + review.rawBytes, 0),
    normalizedInputBytes: ["data/normalized/usda.json", "data/normalized/openfoodfacts.json", "data/recipes.json", "data/restaurant-facts.json", "data/manufacturer-facts.json", "data/reviewed-labels.json"].reduce((sum, path) => sum + readFileSync(path).length, 0),
    normalizedBytes: Buffer.byteLength(artifact + "\n"), gzipBytes: gzipSync(artifact + "\n").length },
  sha256: hash(artifact + "\n"), warnings: [...warnings, ...validation.warnings] };
writeFileSync("data/manifests/food-db.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("public/nutrition/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ version: data.version, counts: manifest.counts, sizes: manifest.sizes, warnings: manifest.warnings }, null, 2));
