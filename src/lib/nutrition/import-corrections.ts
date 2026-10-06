import { customFood, rememberMapping } from "./user-library";
import type { UserData } from "./types";
import type { MealItemSnapshot } from "@/server/db/schema";

/** Explicit import only; keeps the existing reviewed-correction conversion. */
export function importReviewedCorrections(user: UserData, snapshots: MealItemSnapshot[]) {
  let next = user, count = 0;
  for (const item of snapshots) {
    if ((!item.portionEdited && item.source !== "manual") || item.kcal === null || item.protein === null || item.carbs === null || item.fat == null) continue;
    if (next.foods.some((food) => food.canonicalName === item.name)) continue;
    next = customFood(next, { name: item.name, aliases: [], servingAmount: item.grams ?? item.quantity ?? 1,
      unit: item.grams ? "g" : item.unit ?? "serving", nutrition: { kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat, fiber: item.fiber ?? null, sugar: item.sugar ?? null, sodium: null } });
    const foodId = next.foods.at(-1)!.id;
    if (item.grams && item.quantity) next = rememberMapping(next, item.name, foodId, item.grams / item.quantity, "g", item.unit);
    next.revision++; count++;
  }
  return { user: next, count };
}
