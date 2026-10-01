import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { findSession } from "@/server/auth/session";
import { acceptsSameOriginMutation } from "@/server/auth/request-origin";
import type { MealItemSnapshot } from "@/server/db/schema";
import { interpretMeal, type InterpretedItem } from "@/server/nutrition/interpret";
import { lookupIndbFood } from "@/server/nutrition/indb";
import { lookupUsdaFood } from "@/server/nutrition/usda";
import { parseSimpleMeal } from "@/server/nutrition/simple-parser";
import { interpretRecipe } from "@/server/nutrition/recipe";
import { getCachedResolution, getPortionPreference, putCachedResolution } from "@/server/nutrition/personal";
import { approximatePortion, commonApproximation, estimateMissingIngredients, estimateWholeDish, type Approximation } from "@/server/nutrition/fallback";
import { inferredFat, plausibleMacros } from "@/server/nutrition/sanity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.strictObject({ description: z.string().trim().min(1).max(500) });
const headers = { "Cache-Control": "no-store" };
const error = (status: number, message: string, allowManual = false) =>
  NextResponse.json({ error: message, allowManual }, { status, headers });
const round2 = (value: number) => Math.round(value * 100) / 100;

/** An energy-balance fat estimate is explicitly separate from sourced fat. */
function fillMissingFat(snapshot: MealItemSnapshot): MealItemSnapshot {
  if (snapshot.fat != null || snapshot.kcal === null || snapshot.protein === null || snapshot.carbs === null) return snapshot;
  const grams = snapshot.grams ?? (snapshot.quantity ?? 1) * 100;
  const fat = inferredFat(snapshot.kcal, snapshot.protein, snapshot.carbs, grams);
  if (fat === null) return snapshot;
  const note = "Fat approximated from calories, protein and carbs; the reference did not report fat.";
  return { ...snapshot, fat, per100g: snapshot.per100g && snapshot.grams
    ? { ...snapshot.per100g, fat: round2(fat * 100 / snapshot.grams) } : snapshot.per100g,
    matchConfidence: snapshot.matchConfidence === "high" ? "medium" : snapshot.matchConfidence,
    assumptions: [...(snapshot.assumptions ?? []).filter((entry) => entry !== note), note].slice(0, 12),
    uncertainty: [snapshot.uncertainty, note].filter(Boolean).join("; ").slice(0, 500) };
}

function approximateSnapshot(item: InterpretedItem, estimate: Approximation, portionNote: string): MealItemSnapshot {
  const notes = [estimate.assumption, portionNote].filter(Boolean);
  const grams = estimate.grams;
  return { name: item.name, quantity: item.quantity ?? 1, unit: item.unit, grams,
    ...estimate.nutrients, fiber: null, sugar: null, source: "estimated", sourceId: null,
    per100g: { ...Object.fromEntries(Object.entries(estimate.nutrients).map(([key, value]) => [key, round2(value * 100 / grams)])) as
      { kcal: number; protein: number; carbs: number; fat: number }, fiber: null, sugar: null },
    matchConfidence: "low", assumptions: notes.slice(0, 12), portionUncertainty: portionNote || null,
    uncertainty: notes.join("; ").slice(0, 500) };
}

/** Rescale evidence-backed values without changing nutrient provenance. */
function withPersonalPortion(snapshot: MealItemSnapshot, item: InterpretedItem, gramsPerUnit: number | null): MealItemSnapshot {
  if (gramsPerUnit === null || !snapshot.per100g || item.grams !== null) return snapshot;
  const grams = round2(gramsPerUnit * (item.quantity ?? 1));
  if (grams <= 0 || grams > 10000) return snapshot;
  const base = snapshot.per100g;
  const scale = (value: number | null) => value === null ? null : round2(value * grams / 100);
  const note = `Using your saved ${gramsPerUnit} g per ${item.unit ?? "item"} portion; confirm this serving.`;
  const otherNotes = snapshot.uncertainty?.split("; ").filter((entry) => entry !== snapshot.portionUncertainty) ?? [];
  return { ...snapshot, grams, kcal: scale(base.kcal), protein: scale(base.protein), carbs: scale(base.carbs),
    fat: scale(base.fat), fiber: scale(base.fiber), sugar: scale(base.sugar),
    portionUncertainty: note, uncertainty: [...otherNotes, note].join("; ").slice(0, 500),
    assumptions: [...(snapshot.assumptions ?? []).filter((entry) => entry !== snapshot.portionUncertainty), note].slice(0, 12) };
}

async function resolveItem(adminId: string, item: InterpretedItem): Promise<MealItemSnapshot> {
  const base = { name: item.name, quantity: item.quantity, unit: item.unit, grams: item.grams };
  const preference = await getPortionPreference(adminId, item);
  const cached = await getCachedResolution(adminId, item);
  if (cached) return withPersonalPortion(cached, item, preference);
  const indb = await lookupIndbFood(item);
  if (indb.status === "candidate") {
    const snapshot: MealItemSnapshot = { ...base, grams: indb.grams, ...indb.nutrients, fat: null, fiber: null, sugar: null,
      source: "indb", sourceId: indb.sourceId, per100g: indb.per100g,
      matchConfidence: "medium", portionUncertainty: indb.grams === null ? indb.uncertainty.slice(0, 500) : null,
      assumptions: [indb.uncertainty.slice(0, 500)], uncertainty: indb.uncertainty.slice(0, 500) };
    const complete = fillMissingFat(snapshot);
    await putCachedResolution(adminId, item, complete);
    return withPersonalPortion(complete, item, preference);
  }
  const found = await lookupUsdaFood(item);
  if (found.status === "candidate") {
    const snapshot: MealItemSnapshot = { ...base, grams: found.grams, ...found.nutrients,
      source: "usda", sourceId: found.sourceId, per100g: found.per100g,
      matchConfidence: found.matchConfidence, portionUncertainty: found.portionUncertainty?.slice(0, 500) ?? null,
      assumptions: found.assumptions.map((text) => text.slice(0, 500)), uncertainty: found.uncertainty?.slice(0, 500) ?? null };
    const complete = fillMissingFat(snapshot);
    await putCachedResolution(adminId, item, complete);
    return withPersonalPortion(complete, item, preference);
  }
  return { ...base, kcal: null, protein: null, carbs: null, fat: null, fiber: null, sugar: null,
    source: "unmatched", sourceId: null, matchConfidence: "low",
    uncertainty: [indb.reason === "portion_missing" ? indb.uncertainty : null, item.uncertainty, found.uncertainty,
      "No sufficiently supported estimate; review or enter nutrients manually."].filter(Boolean).join("; ").slice(0, 500) };
}

async function tryRecipe(adminId: string, item: InterpretedItem): Promise<MealItemSnapshot | null> {
  const prompt = [item.quantity, item.unit, item.name].filter((part) => part !== null).join(" ");
  const plan = await interpretRecipe(prompt);
  if (!plan.ok) return null;
  const savedWeight = await getPortionPreference(adminId, item);
  const correctedWeight = savedWeight === null ? null : round2(savedWeight * (item.quantity ?? 1));
  const grams = correctedWeight !== null && correctedWeight > 0 && correctedWeight <= 10000 ? correctedWeight : plan.grams;
  const ratio = grams / plan.grams;
  const portionNote = grams !== plan.grams
    ? `Using your saved ${savedWeight} g per ${item.unit ?? "item"} portion; recipe ingredients scaled to ${grams} g. Confirm this serving.`
    : `Estimated recipe portion ${grams} g; check the serving and ingredient amounts.`;
  const statedSauces = /\b([2-9])\s+sauces?\b/i.exec(prompt);
  const sauceIngredients = plan.ingredients.filter((entry) => /\b(sauce|chutney|dressing|mayonnaise|mayo)\b/i.test(entry.name));
  const omittedSauces = statedSauces && sauceIngredients.length < Number(statedSauces[1]) &&
    !sauceIngredients.some((entry) => /\b(assorted|mixed|several|varieties)\b/i.test(entry.name) ||
      entry.name.includes(statedSauces[1]));
  if (omittedSauces) {
    const whole = await estimateWholeDish(prompt, { ...item, grams });
    if (whole) return { ...approximateSnapshot(item, whole, portionNote),
      assumptions: [...whole.assumptions, "Recipe omitted some stated sauces; whole-dish estimate includes a sauce allowance."].slice(0, 12),
      recipeUncertainty: plan.uncertainty };
  }
  const ingredients: NonNullable<MealItemSnapshot["ingredients"]> = [];
  for (let index = 0; index < plan.ingredients.length; index += 3) {
    const batch = await Promise.all(plan.ingredients.slice(index, index + 3).map(async (entry) => {
      const ingredientGrams = Math.max(.01, round2(entry.grams * ratio));
      const resolved = await resolveItem(adminId, { name: entry.name, quantity: null, unit: "g", grams: ingredientGrams, uncertainty: null });
      return { name: entry.name, grams: ingredientGrams, kcal: resolved.kcal, protein: resolved.protein, carbs: resolved.carbs,
        fat: resolved.fat ?? null, source: resolved.source === "recipe_estimate" ? "unmatched" as const : resolved.source,
        sourceId: resolved.sourceId, uncertainty: resolved.uncertainty };
    }));
    ingredients.push(...batch);
  }
  const pending: { name: string; grams: number }[] = [];
  let approximated = 0;
  for (const entry of ingredients) {
    if (entry.kcal !== null && entry.protein !== null && entry.carbs !== null && entry.fat !== null) continue;
    const common = commonApproximation(entry.name, entry.grams);
    if (common) {
      Object.assign(entry, { ...common.nutrients, source: "estimated", sourceId: null, uncertainty: common.assumption });
      approximated++;
    } else pending.push({ name: entry.name, grams: entry.grams });
  }
  if (pending.length) {
    const suggestions = await estimateMissingIngredients(plan.name, pending);
    for (const estimate of suggestions) {
      const entry = ingredients.find((candidate) => candidate.kcal === null && candidate.name === estimate.name && candidate.grams === estimate.grams);
      if (entry) {
        Object.assign(entry, { ...estimate.nutrients, source: "estimated", sourceId: null, uncertainty: estimate.assumption });
        approximated++;
      }
    }
  }
  // A tiny unresolved spice must not erase an otherwise supported recipe.
  for (const entry of ingredients) {
    if (entry.kcal !== null || entry.grams > Math.min(12, grams * .05) ||
        !/\b(spice|masala|chilli|chili|pepper|herb|mint|cumin)\b/i.test(entry.name)) continue;
    const allowance = { kcal: round2(entry.grams * 3), protein: round2(entry.grams * .1),
      carbs: round2(entry.grams * .4), fat: round2(entry.grams * .12) };
    Object.assign(entry, { ...allowance, source: "estimated", sourceId: null,
      uncertainty: "Generic small-spice allowance; exact seasoning composition is unknown." });
    approximated++;
  }
  const complete = ingredients.every((entry) => entry.kcal !== null && entry.protein !== null && entry.carbs !== null && entry.fat !== null);
  const total = (select: (entry: typeof ingredients[number]) => number | null) => complete ?
    round2(ingredients.reduce((sum, entry) => sum + (select(entry) ?? 0), 0)) : null;
  const kcal = total((entry) => entry.kcal), protein = total((entry) => entry.protein), carbs = total((entry) => entry.carbs), fat = total((entry) => entry.fat);
  const assumptions = [plan.name.toLowerCase() === item.name.toLowerCase() ? null : `Interpreted recipe as ${plan.name}.`,
    ...plan.assumptions, portionNote, omittedSauces ? "Some stated sauces may be missing from this ingredient breakdown; review the total." : null,
    approximated ? `${approximated} ingredient${approximated === 1 ? "" : "s"} used approximate composition rather than a verified match.` : null]
    .filter((entry): entry is string => entry !== null).slice(0, 12);
  const uncertainty = [item.uncertainty, plan.uncertainty, ...assumptions].filter(Boolean).join("; ").slice(0, 500);
  const consistent = complete && kcal !== null && protein !== null && carbs !== null && fat !== null &&
    plausibleMacros({ kcal, protein, carbs, fat }, grams);
  if (!consistent) {
    const fallback = await estimateWholeDish(prompt, { ...item, grams });
    if (fallback) return { ...approximateSnapshot(item, fallback, portionNote),
      assumptions: [...fallback.assumptions, "Whole-dish estimate used because some ingredient values were unavailable."].slice(0, 12),
      recipeUncertainty: plan.uncertainty };
  }
  return { name: item.name, quantity: item.quantity ?? 1, unit: item.unit, grams,
    kcal: consistent ? kcal : null, protein: consistent ? protein : null, carbs: consistent ? carbs : null,
    fat: consistent ? fat : null, fiber: null, sugar: null, source: "recipe_estimate", sourceId: null,
    uncertainty: consistent ? uncertainty : `${uncertainty}; Ingredient totals could not be validated.`.slice(0, 500),
    recipeUncertainty: plan.uncertainty, portionUncertainty: portionNote,
    matchConfidence: "low", assumptions,
    ingredients };
}

export async function POST(request: NextRequest) {
  if (!acceptsSameOriginMutation(request)) return error(403, "Forbidden");
  const token = request.cookies.get("mealio_session")?.value;
  if (!token) return error(401, "Unauthorized");
  let auth: Awaited<ReturnType<typeof findSession>>;
  try { auth = await findSession(token); } catch { return error(503, "Service unavailable"); }
  if (!auth) return error(401, "Unauthorized");
  let body: unknown;
  try { const raw = await request.text(); if (raw.length > 2048) return error(400, "Invalid request"); body = JSON.parse(raw); }
  catch { return error(400, "Invalid request"); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error(400, "Invalid request");

  const simple = parseSimpleMeal(parsed.data.description);
  const interpretation = simple ? { ok: true as const, items: simple } : await interpretMeal(parsed.data.description);
  if (!interpretation.ok) {
    const guess: InterpretedItem = { name: parsed.data.description, quantity: null, unit: null, grams: null, uncertainty: null };
    const whole = await estimateWholeDish(parsed.data.description, guess);
    if (!whole) return error(503, "Interpretation unavailable", true);
    const item = approximateSnapshot(guess, whole, `Estimated ${whole.grams} g serving; confirm portion.`);
    item.assumptions = [...whole.assumptions, ...(item.assumptions ?? [])].slice(0, 12);
    return NextResponse.json({ items: [item], totals: whole.nutrients, incomplete: false, estimated: true }, { headers });
  }

  const items: MealItemSnapshot[] = [];
  for (let index = 0; index < interpretation.items.length; index += 3) {
    const batch = interpretation.items.slice(index, index + 3);
    items.push(...await Promise.all(batch.map(async (item) => {
      const itemDescription = interpretation.items.length > 1
        ? [item.quantity, item.unit, item.name].filter((part) => part !== null).join(" ")
        : parsed.data.description;
      const result = await resolveItem(auth.admin.id, item);
      if (result.source !== "unmatched" && result.fat != null) return result;
      if (result.source !== "unmatched") {
        const estimated = await estimateWholeDish(itemDescription, { ...item, grams: result.grams });
        if (estimated && result.kcal !== null && result.protein !== null && result.carbs !== null &&
            Math.abs(result.kcal - estimated.nutrients.kcal) <= Math.max(35, result.kcal * .25) &&
            plausibleMacros({ kcal: result.kcal, protein: result.protein, carbs: result.carbs, fat: estimated.nutrients.fat },
              result.grams ?? estimated.grams)) {
          const note = "Fat is a model approximation; the reference did not provide fat. Confirm preparation.";
          return { ...result, grams: result.grams ?? estimated.grams, fat: estimated.nutrients.fat, matchConfidence: "low" as const,
            uncertainty: [result.uncertainty, note].filter(Boolean).join("; ").slice(0, 500),
            assumptions: [...(result.assumptions ?? []), note].slice(0, 12),
            per100g: result.per100g && (result.grams ?? estimated.grams) ? { ...result.per100g,
              fat: round2(estimated.nutrients.fat * 100 / (result.grams ?? estimated.grams)) } : result.per100g };
        }
        if (estimated) {
          const note = "The reference did not provide a usable fat value; using a low-confidence whole-dish estimate instead.";
          return { ...approximateSnapshot(item, estimated, `Estimated ${estimated.grams} g serving; confirm portion.`),
            assumptions: [...estimated.assumptions, note].slice(0, 12),
            uncertainty: [estimated.assumption, note].join("; ").slice(0, 500) };
        }
        return result;
      }
      const savedWeight = await getPortionPreference(auth.admin.id, item);
      const savedGrams = savedWeight === null ? null : round2(savedWeight * (item.quantity ?? 1));
      const portion = savedGrams !== null && savedGrams > 0 && savedGrams <= 10000
        ? { grams: savedGrams, note: `Using your saved ${savedWeight} g per ${item.unit ?? "item"} portion; confirm this serving.` }
        : approximatePortion(item);
      const common = portion && commonApproximation(item.name, portion.grams);
      if (common) return approximateSnapshot(item, common, portion.note);
      if (simple) {
        const whole = await estimateWholeDish(itemDescription, { ...item, grams: portion?.grams ?? item.grams });
        return whole ? approximateSnapshot(item, whole, portion?.note ?? `Estimated ${whole.grams} g serving; confirm portion.`) : result;
      }
      const recipe = await tryRecipe(auth.admin.id, item);
      if (recipe && recipe.kcal !== null && recipe.protein !== null && recipe.carbs !== null && recipe.fat !== null) return recipe;
      const whole = await estimateWholeDish(itemDescription, { ...item, grams: savedGrams ?? item.grams });
      if (whole) return { ...approximateSnapshot(item, whole, `Estimated ${whole.grams} g serving; confirm portion.`),
        assumptions: [...whole.assumptions, whole.assumption].slice(0, 12) };
      if (recipe) return recipe;
      const grams = savedGrams;
      if (grams === null || grams <= 0 || grams > 10000) return result;
      const note = `Using your saved ${savedWeight} g per ${item.unit ?? "item"} portion; nutrients still need review.`;
      return { ...result, quantity: item.quantity ?? 1, grams, portionUncertainty: note, assumptions: [note],
        uncertainty: [result.uncertainty, note].filter(Boolean).join("; ").slice(0, 500) };
    })));
  }
  const complete = items.every((item) => item.kcal !== null && item.protein !== null && item.carbs !== null);
  const sum = (select: (item: MealItemSnapshot) => number | null | undefined) => round2(items.reduce((total, item) => total + (select(item) ?? 0), 0));
  const totals = complete ? { kcal: sum((item) => item.kcal), protein: sum((item) => item.protein), carbs: sum((item) => item.carbs),
    fat: items.every((item) => item.fat !== null && item.fat !== undefined) ? sum((item) => item.fat) : null } : null;
  return NextResponse.json({ items, totals, incomplete: !complete, estimated: true }, { headers });
}
