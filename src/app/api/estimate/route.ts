import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { findSession } from "@/server/auth/session";
import { acceptsSameOriginMutation } from "@/server/auth/request-origin";
import type { MealItemSnapshot } from "@/server/db/schema";
import { interpretMeal, type InterpretedItem } from "@/server/nutrition/interpret";
import { lookupIndbFood } from "@/server/nutrition/indb";
import { lookupUsdaFood } from "@/server/nutrition/usda";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.strictObject({ description: z.string().trim().min(1).max(500) });
const headers = { "Cache-Control": "no-store" };
const error = (status: number, message: string, allowManual = false) =>
  NextResponse.json({ error: message, allowManual }, { status, headers });

async function snapshot(item: InterpretedItem): Promise<MealItemSnapshot> {
  const base = { name: item.name, quantity: item.quantity, unit: item.unit, grams: item.grams };
  const indb = await lookupIndbFood(item);
  if (indb.status === "candidate") return {
    ...base, grams: indb.grams, ...indb.nutrients, source: "indb", sourceId: indb.sourceId,
    uncertainty: indb.uncertainty.slice(0, 500),
  };
  const found = await lookupUsdaFood(item);
  if (found.status !== "candidate") return {
    ...base, kcal: null, protein: null, carbs: null, source: "unmatched", sourceId: null,
    uncertainty: [item.uncertainty, found.uncertainty].filter(Boolean).join("; ").slice(0, 500),
  };
  return {
    ...base, grams: found.grams, ...found.nutrients, source: "usda", sourceId: found.sourceId,
    uncertainty: found.uncertainty?.slice(0, 500) ?? null,
  };
}

export async function POST(request: NextRequest) {
  if (!acceptsSameOriginMutation(request)) return error(403, "Forbidden");
  const token = request.cookies.get("mealio_session")?.value;
  if (!token) return error(401, "Unauthorized");
  try {
    if (!await findSession(token)) return error(401, "Unauthorized");
  } catch {
    return error(503, "Service unavailable");
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return error(400, "Invalid request");
    body = JSON.parse(raw);
  } catch {
    return error(400, "Invalid request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error(400, "Invalid request");
  const interpretation = await interpretMeal(parsed.data.description);
  if (!interpretation.ok) return error(503, "Interpretation unavailable", true);

  const items: MealItemSnapshot[] = [];
  for (let index = 0; index < interpretation.items.length; index += 3) {
    const batch = interpretation.items.slice(index, index + 3);
    items.push(...await Promise.all(batch.map(snapshot)));
  }
  const complete = items.every((item) => item.kcal !== null && item.protein !== null && item.carbs !== null);
  const totals = complete ? items.reduce((sum, item) => ({
    kcal: sum.kcal + (item.kcal ?? 0),
    protein: sum.protein + (item.protein ?? 0),
    carbs: sum.carbs + (item.carbs ?? 0),
  }), { kcal: 0, protein: 0, carbs: 0 }) : null;
  if (totals) {
    totals.kcal = Math.round(totals.kcal * 100) / 100;
    totals.protein = Math.round(totals.protein * 100) / 100;
    totals.carbs = Math.round(totals.carbs * 100) / 100;
  }
  return NextResponse.json({ items, totals, incomplete: !complete, estimated: true }, { headers });
}
