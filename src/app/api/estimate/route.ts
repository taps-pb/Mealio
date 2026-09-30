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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.strictObject({ description: z.string().trim().min(1).max(500) });
const headers = { "Cache-Control": "no-store" };
const error = (status: number, message: string, allowManual = false) =>
  NextResponse.json({ error: message, allowManual }, { status, headers });
const round2 = (value: number) => Math.round(value * 100) / 100;

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
    await putCachedResolution(adminId, item, snapshot);
    return withPersonalPortion(snapshot, item, preference);
  }
  const found = await lookupUsdaFood(item);
  if (found.status === "candidate") {
    const snapshot: MealItemSnapshot = { ...base, grams: found.grams, ...found.nutrients,
      source: "usda", sourceId: found.sourceId, per100g: found.per100g,
      matchConfidence: found.matchConfidence, portionUncertainty: found.portionUncertainty?.slice(0, 500) ?? null,
      assumptions: found.assumptions.map((text) => text.slice(0, 500)), uncertainty: found.uncertainty?.slice(0, 500) ?? null };
    await putCachedResolution(adminId, item, snapshot);
    return withPersonalPortion(snapshot, item, preference);
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
  const complete = ingredients.every((entry) => entry.kcal !== null && entry.protein !== null && entry.carbs !== null);
  const total = (select: (entry: typeof ingredients[number]) => number | null) => complete ?
    round2(ingredients.reduce((sum, entry) => sum + (select(entry) ?? 0), 0)) : null;
  const fat = complete && ingredients.every((entry) => entry.fat !== null) ? total((entry) => entry.fat) : null;
  const assumptions = [plan.name.toLowerCase() === item.name.toLowerCase() ? null : `Interpreted recipe as ${plan.name}.`,
    ...plan.assumptions, portionNote].filter((entry): entry is string => entry !== null).slice(0, 12);
  const uncertainty = [item.uncertainty, plan.uncertainty, ...assumptions].filter(Boolean).join("; ").slice(0, 500);
  return { name: item.name, quantity: item.quantity ?? 1, unit: item.unit, grams,
    kcal: total((entry) => entry.kcal), protein: total((entry) => entry.protein), carbs: total((entry) => entry.carbs),
    fat, fiber: null, sugar: null, source: "recipe_estimate", sourceId: null, uncertainty,
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
  if (!interpretation.ok) return error(503, "Interpretation unavailable", true);

  const items: MealItemSnapshot[] = [];
  for (let index = 0; index < interpretation.items.length; index += 3) {
    const batch = interpretation.items.slice(index, index + 3);
    items.push(...await Promise.all(batch.map(async (item) => {
      const result = await resolveItem(auth.admin.id, item);
      if (result.source !== "unmatched" || simple) return result;
      const recipe = await tryRecipe(auth.admin.id, item);
      if (recipe) return recipe;
      const savedWeight = await getPortionPreference(auth.admin.id, item);
      const grams = savedWeight === null ? null : round2(savedWeight * (item.quantity ?? 1));
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
