import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { nutritionCache, portionPreferences, type MealItemSnapshot } from "@/server/db/schema";
import { snapshotSchema } from "@/server/meals/validation";
import type { InterpretedItem } from "./interpret";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
/** Context-specific: brand/preparation/sauce tokens remain in the complete name. */
export function resolutionKey(item: Pick<InterpretedItem, "name" | "quantity" | "unit" | "grams">): string {
  // Bump when match/portion rules change: old cached candidates may be unsafe.
  return JSON.stringify(["v3", normalize(item.name), item.quantity, normalize(item.unit ?? ""), item.grams]);
}
export function preferenceKey(item: Pick<InterpretedItem, "name" | "unit">) {
  return { foodKey: normalize(item.name), unit: normalize(item.unit ?? "") };
}

export async function getCachedResolution(adminId: string, item: InterpretedItem): Promise<MealItemSnapshot | null> {
  try {
    const [row] = await getDb().select({ snapshot: nutritionCache.snapshot }).from(nutritionCache).where(and(
      eq(nutritionCache.adminId, adminId), eq(nutritionCache.key, resolutionKey(item)), gt(nutritionCache.expiresAt, new Date()),
    )).limit(1);
    const parsed = snapshotSchema.safeParse(row?.snapshot);
    return parsed.success && ["usda", "indb"].includes(parsed.data.source) ? parsed.data as MealItemSnapshot : null;
  } catch { return null; }
}

export async function putCachedResolution(adminId: string, item: InterpretedItem, snapshot: MealItemSnapshot): Promise<void> {
  if (!["usda", "indb"].includes(snapshot.source) || snapshot.matchConfidence === "low" || snapshot.portionEdited ||
    !snapshotSchema.safeParse(snapshot).success) return;
  try {
    await getDb().insert(nutritionCache).values({ adminId, key: resolutionKey(item), snapshot,
      expiresAt: new Date(Date.now() + 7 * 86400000) }).onConflictDoUpdate({ target: [nutritionCache.adminId, nutritionCache.key],
      set: { snapshot, expiresAt: new Date(Date.now() + 7 * 86400000) } });
  } catch { /* Optional cache must not prevent a meal estimate. */ }
}

export async function getPortionPreference(adminId: string, item: InterpretedItem): Promise<number | null> {
  if (item.grams !== null) return null;
  try {
    const key = preferenceKey(item);
    const [row] = await getDb().select({ gramsPerUnit: portionPreferences.gramsPerUnit }).from(portionPreferences).where(and(
      eq(portionPreferences.adminId, adminId), eq(portionPreferences.foodKey, key.foodKey), eq(portionPreferences.unit, key.unit),
    )).limit(1);
    return row && Number.isFinite(row.gramsPerUnit) && row.gramsPerUnit > 0 ? row.gramsPerUnit : null;
  } catch { return null; }
}

/** Call only after owner-confirmed save; never learn an inferred serving. */
export async function savePortionCorrections(adminId: string, snapshots: MealItemSnapshot[]): Promise<void> {
  for (const item of snapshots) {
    if (item.portionEdited !== true || item.grams === null || item.quantity === null || !Number.isFinite(item.grams / item.quantity) ||
      item.grams / item.quantity <= 0 || item.grams / item.quantity > 10000) continue;
    const { foodKey, unit } = preferenceKey(item);
    const gramsPerUnit = Math.round(item.grams / item.quantity * 100) / 100;
    try {
      await getDb().insert(portionPreferences).values({ adminId, foodKey, unit, gramsPerUnit })
        .onConflictDoUpdate({ target: [portionPreferences.adminId, portionPreferences.foodKey, portionPreferences.unit],
          set: { gramsPerUnit, updatedAt: new Date() } });
    } catch { /* Preference persistence must not undo the saved meal. */ }
  }
}
