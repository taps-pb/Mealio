import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { meals, type Meal } from "@/server/db/schema";
import { groupMealsByDay, localDayKey } from "./day";
import type { MealInput, MealUpdate } from "./validation";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameSavedMeal(row: Meal, input: MealInput): boolean {
  return row.description === input.description &&
    row.eatenAt.getTime() === input.eatenAt.getTime() &&
    row.kcal === input.kcal && row.protein === input.protein && row.carbs === input.carbs &&
    row.provenance === input.provenance &&
    stableJson(row.itemSnapshots) === stableJson(input.itemSnapshots);
}

export async function listMeals(adminId: string, timezone: string) {
  const rows = await getDb().select().from(meals).where(eq(meals.adminId, adminId))
    .orderBy(desc(meals.eatenAt));
  return { todayKey: localDayKey(new Date(), timezone), groups: groupMealsByDay(rows, timezone) };
}

export async function createMeal(adminId: string, input: MealInput) {
  const db = getDb();
  const values = { ...input, adminId };
  const [created] = await db.insert(meals).values(values)
    .onConflictDoNothing({ target: [meals.adminId, meals.idempotencyKey] }).returning();
  if (created) return { status: "created" as const, meal: created };
  const [existing] = await db.select().from(meals).where(and(
    eq(meals.adminId, adminId), eq(meals.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (!existing) throw new Error("Meal idempotency conflict without row");
  return sameSavedMeal(existing, input)
    ? { status: "duplicate" as const, meal: existing }
    : { status: "conflict" as const };
}

export async function updateMeal(adminId: string, id: string, input: MealUpdate) {
  // Input comes from the review form. No AI call here and no data is re-estimated.
  const [updated] = await getDb().update(meals).set({ ...input, updatedAt: new Date() })
    .where(and(eq(meals.adminId, adminId), eq(meals.id, id))).returning();
  return updated ?? null;
}

export async function deleteMeal(adminId: string, id: string): Promise<boolean> {
  const deleted = await getDb().delete(meals)
    .where(and(eq(meals.adminId, adminId), eq(meals.id, id))).returning({ id: meals.id });
  return deleted.length > 0;
}
