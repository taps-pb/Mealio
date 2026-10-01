import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { InterpretedItem } from "./interpret";
import { inferredFat, plausibleMacros } from "./sanity";

export type Nutrients = { kcal: number; protein: number; carbs: number; fat: number | null; fiber: number | null; sugar: number | null };
export type LookupResult =
  | { status: "candidate"; sourceId: string; description: string; grams: number; nutrients: Nutrients;
      per100g: Nutrients; uncertainty: string | null; matchConfidence: "high" | "medium" | "low";
      portionUncertainty: string | null; assumptions: string[] }
  | { status: "unmatched" | "unavailable"; uncertainty: string };

const round2 = (value: number) => Math.round(value * 100) / 100;
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const queryHint: Record<string, string> = { apple: "Apples, raw, with skin", banana: "Bananas, raw",
  egg: "Egg, whole, raw, fresh", orange: "Oranges, raw, all commercial varieties",
  milk: "Milk, whole, 3.25% milkfat", mango: "Mangos, raw", "cooked rice": "Rice, white, long-grain, regular, enriched, cooked",
  onion: "Onions, raw", tomato: "Tomatoes, red, ripe, raw, year round average", water: "Water, tap, drinking",
  cashews: "Nuts, cashew nuts, raw", "green bell pepper": "Peppers, sweet, green, raw",
  potato: "Potatoes, flesh and skin, raw", "boiled potato": "Potatoes, boiled, cooked without skin, flesh, without salt",
  "boiled egg": "Egg, whole, cooked, hard-boiled", ghee: "Butter, Clarified butter (ghee)",
  "cumin seeds": "Spices, cumin seed", "red chilli powder": "Spices, chili powder",
  "whole milk": "Milk, whole, 3.25% milkfat", "plain yogurt": "Yogurt, plain, whole milk" };
const roots: Record<string, string> = { apple: "apple", apples: "apple", banana: "banana", bananas: "banana",
  egg: "egg", eggs: "egg", orange: "orange", oranges: "orange", mango: "mango", mangos: "mango",
  milk: "milk", rice: "rice", onion: "onion", onions: "onion", tomato: "tomato", tomatoes: "tomato",
  cashew: "cashew", cashews: "cashew", pepper: "pepper", peppers: "pepper", potato: "potato",
  potatoes: "potato", seed: "seed", seeds: "seed" };
const unsafeExtras = new Set(["fried", "grilled", "pie", "juice", "sauce", "syrup", "dried", "powder", "canned", "breaded",
  "scrambled", "white", "yolk", "sweetened", "sugar", "candy", "butter", "flavored", "flavoured", "baby",
  "rings", "soup", "condensed", "convolvulus", "dehydrated", "paste", "ketchup", "bread",
  "pancakes", "chips", "snacks", "sweet"]);

function parseKeyFile(raw: string): string | null {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  const match = /^USDA_API_KEY\s*=\s*(.*)$/.exec(lines[0]);
  let key = (match ? match[1] : lines[0]).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  return key && key.length <= 512 && !/[\s='"]/.test(key) ? key : null;
}
async function resolveApiKey(explicit: string | undefined): Promise<string | null> {
  if (explicit !== undefined) return explicit.trim() || null;
  if (process.env.USDA_API_KEY?.trim()) return process.env.USDA_API_KEY.trim();
  try { return parseKeyFile(await readFile(/* turbopackIgnore: true */ process.env.USDA_KEY_FILE || resolve(process.cwd(), "../.secrets/usda_api.txt"), "utf8")); }
  catch { return null; }
}

function suitable(name: string, description: string): { rank: number; confidence: "high" | "medium" } | null {
  const q = normalize(name), d = normalize(description);
  const qt = q.split(" "), dt = d.split(" ");
  const core = roots[qt.at(-1) ?? ""] ?? qt.at(-1);
  if (q === "red chilli powder" && d === "spices chili powder") return { rank: 6, confidence: "medium" };
  if (q === "ice" || q === "poha" && dt[0] !== "poha" ||
      q === "whole milk" && dt[0] !== "milk" ||
      (q === "yogurt" || q === "plain yogurt") &&
        (dt[0] !== "yogurt" || !dt.includes("plain") || dt.some((token) => ["tofu", "soy", "silk", "coconut", "almond"].includes(token))) ||
      q === "olive oil" && (dt[0] !== "oil" || dt.some((token) => ["corn", "peanut", "blend", "mixed"].includes(token)))) return null;
  if (!core || !dt.some((token) => (roots[token] ?? token) === core)) return null;
  const known = ["apple", "banana", "egg", "orange", "mango", "milk", "rice", "onion", "tomato", "water", "cashew", "pepper", "potato", "seed", "ghee"].includes(core);
  if (qt.some((token) => (roots[token] ?? token) !== core && !dt.includes(token) &&
    !(q === "green bell pepper" && token === "bell" && dt.includes("sweet")) &&
    !(token === "boiled" && core === "rice" && dt.includes("cooked")) &&
    !(token === "boiled" && core === "potato" && dt.includes("boiled")))) return null;
  if (dt.some((token) => unsafeExtras.has(token) && !qt.includes(token) &&
    !(core === "rice" && token === "white") && !(core === "milk" && token === "whole") &&
    !(core === "ghee" && token === "butter") &&
    !(q === "green bell pepper" && token === "sweet"))) return null;
  if (core === "rice" && !dt.includes("cooked")) return null;
  if (core === "egg" && (!dt.includes("whole") || (qt.includes("boiled") ? !dt.includes("boiled") : !dt.includes("raw")))) return null;
  if (["apple", "banana", "orange", "mango"].includes(core) && !dt.includes("raw")) return null;
  if (core === "milk" && (!dt.includes("whole") || dt.includes("skim") || dt[0] !== "milk")) return null;
  if (["onion", "tomato", "cashew"].includes(core) && !dt.includes("raw")) return null;
  if (q === "green bell pepper" && (!dt.includes("sweet") || !dt.includes("green") || !dt.includes("raw") || dt.includes("hot"))) return null;
  if (core === "water" && !/^(?:beverages )?water (?:tap|bottled|purified|municipal|plain)\b/.test(d)) return null;
  if (core === "potato" && (dt.includes("sweet") || dt.includes("skin") && !dt.includes("flesh") ||
      (q === "boiled potato" ? !dt.includes("boiled") || !dt.includes("flesh") : !dt.includes("raw")))) return null;
  if (core === "ghee" && !(dt.includes("clarified") && dt.includes("butter"))) return null;
  if (q === "cumin seeds" && (!dt.includes("cumin") || !dt.includes("seed") || !dt.includes("spices"))) return null;
  if (!known && qt.some((token) => !dt.includes(token))) return null;
  const hint = queryHint[q];
  const rank = (hint && normalize(hint) === d ? 10 : 0) + (d === q ? 5 : 0) + qt.filter((token) => dt.includes(token)).length * 2 - dt.length * .03;
  return { rank, confidence: hint && normalize(hint) === d || d === q ? "high" : "medium" };
}

function parseNutrients(food: { foodNutrients?: unknown }): Nutrients | null {
  if (!Array.isArray(food.foodNutrients)) return null;
  const entries = food.foodNutrients as { nutrientId?: number; value?: unknown }[];
  const find = (id: number): number | null => {
    const value = entries.find((entry) => entry?.nutrientId === id)?.value;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000 ? value : null;
  };
  const kcal = find(1008), protein = find(1003), carbs = find(1005);
  if (kcal === null || protein === null || carbs === null) return null;
  return { kcal, protein, carbs, fat: find(1004), fiber: find(1079), sugar: find(2000) };
}

const scale = (data: Nutrients, grams: number): Nutrients => ({
  kcal: round2(data.kcal * grams / 100), protein: round2(data.protein * grams / 100), carbs: round2(data.carbs * grams / 100),
  fat: data.fat === null ? null : round2(data.fat * grams / 100),
  fiber: data.fiber === null ? null : round2(data.fiber * grams / 100),
  sugar: data.sugar === null ? null : round2(data.sugar * grams / 100),
});

/** Conservative candidate; source values are per 100 g, portion assumptions are explicit. */
export async function lookupUsdaFood(item: InterpretedItem, options: { fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<LookupResult> {
  const key = await resolveApiKey(options.apiKey);
  if (!key) return { status: "unavailable", uncertainty: "Nutrition lookup unavailable." };
  const name = normalize(item.name);
  const canonical = name === "boiled rice" ? "cooked rice" :
    name === "potato boiled and mashed" ? "boiled potato" :
    name === "potato raw" ? "potato" :
    name === "onion raw finely chopped" ? "onion" :
    name === "red chili powder" ? "red chilli powder" : name;
  // A plate of pasta or an unspecified cheese topping is not a 100 g food unit.
  // Ask the recipe estimator to infer the meal/condiment portion instead.
  if (item.grams === null && (canonical === "cheese" || canonical.includes("pasta") && /\bplate\b/.test(item.unit ?? "") ||
      /^(?:ghee|butter|oil|(?:[\w-]+ )?oil|salt|(?:[\w-]+ )?spice|(?:[\w-]+ )?powder)$/.test(canonical)))
    return { status: "unmatched", uncertainty: "Portion needs a recipe estimate rather than a generic 100 g serving." };
  const query = queryHint[canonical] ?? item.name;
  try {
    const request = options.fetchImpl ?? fetch;
    const api = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`;
    const response = await request(api, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, dataType: ["Foundation", "SR Legacy"], pageSize: 15 }),
      signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) return { status: "unavailable", uncertainty: "Nutrition lookup unavailable." };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("foods" in payload) || !Array.isArray(payload.foods)) return { status: "unavailable", uncertainty: "Nutrition lookup returned invalid data." };
    const candidates = payload.foods.flatMap((food: unknown) => {
      if (!food || typeof food !== "object" || !("description" in food) || typeof food.description !== "string" ||
        !("fdcId" in food) || !Number.isInteger(food.fdcId) || typeof food.fdcId !== "number") return [];
      const candidate = food as { description: string; fdcId: number; foodNutrients?: unknown };
      const match = suitable(canonical, candidate.description);
      const per100g = parseNutrients(candidate);
      const consistent = per100g && (per100g.fat === null
        ? per100g.kcal <= 950 && per100g.protein + per100g.carbs <= 105 &&
          inferredFat(per100g.kcal, per100g.protein, per100g.carbs, 100) !== null
        : plausibleMacros({ kcal: per100g.kcal, protein: per100g.protein, carbs: per100g.carbs, fat: per100g.fat }, 100));
      return match && consistent && per100g && !(canonical === "water" && per100g.kcal !== 0) ? [{ food: candidate, match, per100g }] : [];
    }).sort((a, b) => b.match.rank - a.match.rank);
    if (!candidates.length) return { status: "unmatched", uncertainty: "No sufficiently matching USDA food with complete nutrients." };
    const { food, match, per100g } = candidates[0];
    let grams = item.grams;
    let portionUncertainty: string | null = null;
    const assumptions: string[] = [];
    if (canonical === "egg") assumptions.push("Whole raw egg nutrient reference; cooking or added fat changes values.");
    if (canonical === "milk") assumptions.push("Whole milk nutrient reference; other fat levels differ.");
    if (canonical === "cooked rice") assumptions.push("White cooked rice nutrient reference; variety and added oil differ.");
    if (canonical === "green bell pepper") assumptions.push("Bell pepper matched to USDA sweet green pepper; preparation may differ.");
    if (canonical === "red chilli powder") assumptions.push("USDA chili powder blend used as a proxy for red chilli powder; spices differ.");
    if (canonical === "ghee") assumptions.push("USDA clarified butter used as a proxy for ghee; fat content may differ.");
    const unit = normalize(item.unit ?? "");
    if (grams === null && /\bhandful\b/.test(unit) && /\b(almond|nut|cashew|peanut|walnut|pistachio|seed)s?\b/.test(canonical)) {
      const count = item.quantity ?? 1;
      if (count > 0 && count <= 100) {
        const perHandful = /\bsmall\b/.test(unit) ? 15 : /\blarge\b/.test(unit) ? 40 : 28;
        grams = round2(count * perHandful);
        portionUncertainty = `Estimated ${grams} g (${count} × ${perHandful} g typical ${unit}); no source-backed portion weight was available. Confirm the handful size.`;
        assumptions.push(portionUncertainty);
      }
    }
    if (grams === null) {
      const units = ["small", "medium", "large"].includes(normalize(item.unit ?? "")) ? normalize(item.unit ?? "") :
        (name === "egg" || name === "boiled egg") ? "large" : ["apple", "banana", "orange"].includes(name) ? "medium" :
        name === "mango" ? "fruit" :
        (name === "milk" || name === "cooked rice" || name === "boiled rice") && ["glass", "cup"].includes(normalize(item.unit ?? "")) ? "cup" : "";
      // A detail outage must not discard the matched per-100g nutrition.
      try {
        const detail = await request(`https://api.nal.usda.gov/fdc/v1/food/${food.fdcId}?api_key=${encodeURIComponent(key)}`, {
          signal: AbortSignal.timeout(10000), cache: "no-store" });
        const data: unknown = detail.ok ? await detail.json() : null;
        if (data && typeof data === "object" && "description" in data && data.description === food.description &&
            "foodPortions" in data && Array.isArray(data.foodPortions)) {
          const ref = data.foodPortions.find((portion: { amount?: number; modifier?: string; gramWeight?: number }) =>
            portion?.amount === 1 && typeof portion.modifier === "string" && !!units &&
            new RegExp(`^(?:1 )?${units}(?: |$)`).test(normalize(portion.modifier)) && typeof portion.gramWeight === "number" &&
            Number.isFinite(portion.gramWeight) && portion.gramWeight >= 5 && portion.gramWeight <= 1000);
          if (ref) {
            grams = round2(ref.gramWeight * (item.quantity ?? 1));
            portionUncertainty = `Estimated ${item.quantity ?? 1} × ${ref.gramWeight} g USDA ${ref.modifier} portion; confirm size${item.unit === "glass" ? " (glass assumed one cup)" : ""}.`;
            assumptions.push(portionUncertainty);
          }
        }
      } catch { /* A clearly labeled low-confidence generic portion remains available. */ }
      if (grams === null) {
        const count = item.quantity ?? 1;
        if (!Number.isFinite(count) || count <= 0 || count > 100) return { status: "unmatched", uncertainty: "Portion amount unknown; enter a measured weight." };
        const typical = ({ apple: 182, banana: 118, egg: 50, "boiled egg": 50, orange: 131, mango: 200,
          milk: ["glass", "cup"].includes(item.unit ?? "") ? 244 : 100,
          "cooked rice": item.unit === "cup" ? 158 : 100 } as Record<string, number>)[canonical] ?? 100;
        grams = round2(typical * count);
        portionUncertainty = `Estimated ${grams} g (${count} × ${typical} g typical serving); no source-backed portion weight was available for this matched food. Confirm the weight${item.unit === "glass" ? " (glass assumed one cup)" : ""}.`;
        assumptions.push(portionUncertainty);
      }
    }
    if (!Number.isFinite(grams) || grams <= 0 || grams > 10000) return { status: "unmatched", uncertainty: "Portion amount outside supported range." };
    const rank = portionUncertainty?.includes("no source-backed") ? "low" :
      assumptions.length > (portionUncertainty ? 1 : 0) ? "medium" : match.confidence;
    return { status: "candidate", sourceId: String(food.fdcId), description: food.description, grams,
      per100g, nutrients: scale(per100g, grams), matchConfidence: rank,
      portionUncertainty, uncertainty: [item.uncertainty, portionUncertainty,
        normalize(food.description) !== normalize(query) ? `Check USDA match: ${food.description}` : null].filter(Boolean).join("; ") || null,
      assumptions };
  } catch {
    return { status: "unavailable", uncertainty: "Nutrition lookup unavailable." };
  }
}
