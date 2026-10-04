import { createHash } from "node:crypto";
import type { NutritionEngine } from "@/lib/nutrition/engine";
import { toSnapshots } from "@/lib/nutrition/snapshots";
import type { MealItemSnapshot } from "@/server/db/schema";
import { mealUpdateSchema } from "./validation";

/** Entire stored row: identity/time/original text survive recalculation verbatim. */
export type HistoryRow = {
  id: string; admin_id: string; description: string; eaten_at: string;
  kcal: number; protein: number; carbs: number; fat: number | null;
  item_snapshots: MealItemSnapshot[]; provenance: "manual" | "estimated" | "corrected";
  idempotency_key: string | null; created_at: string; updated_at: string;
};
export type ReestimatePlan = {
  databaseVersion: string; before: HistoryRow[]; after: HistoryRow[]; changedIds: string[];
  pending: { id: string; reason: "manual_correction" | "unresolved" | "invalid_input"; components: string[] }[];
};

const nutritionKeys = new Set(["kcal", "protein", "carbs", "fat", "item_snapshots", "provenance", "updated_at"]);
const round = (value: number) => Math.round(value * 100) / 100;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function normalizedRows(rows: HistoryRow[]) {
  return rows.map((row) => ({ ...row, eaten_at: new Date(row.eaten_at).toISOString(), created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function historyFingerprint(rows: HistoryRow[]): string {
  return createHash("sha256").update(JSON.stringify(canonical(normalizedRows(rows)))).digest("hex");
}
export function assertHistoryIdentity(before: HistoryRow[], after: HistoryRow[]) {
  const identity = (rows: HistoryRow[]) => normalizedRows(rows).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !nutritionKeys.has(key))));
  if (before.length !== after.length || new Set(before.map((r) => r.id)).size !== before.length || new Set(after.map((r) => r.id)).size !== after.length ||
      JSON.stringify(canonical(identity(before))) !== JSON.stringify(canonical(identity(after)))) {
    throw new Error("Recalculation changed meal identities, original text, timestamps, or row count");
  }
}

export function planHistoryReestimate(rows: HistoryRow[], engine: NutritionEngine, options: { replaceCorrections: boolean; updatedAt: string }): ReestimatePlan {
  const before = structuredClone(rows), after = structuredClone(rows);
  const plan: ReestimatePlan = { databaseVersion: engine.catalog.data.version, before, after, changedIds: [], pending: [] };
  for (let index = 0; index < before.length; index++) {
    const row = before[index];
    if (!options.replaceCorrections && (row.provenance !== "estimated" || row.item_snapshots.some((item) => item.source === "manual" || item.portionEdited))) {
      plan.pending.push({ id: row.id, reason: "manual_correction", components: [] }); continue;
    }
    try {
      const estimate = engine.estimate(row.description);
      if (estimate.incomplete || !estimate.totals) {
        plan.pending.push({ id: row.id, reason: "unresolved", components: estimate.items.filter((item) => item.status !== "resolved").map((item) => item.parsed.rawText) }); continue;
      }
      const snapshots = toSnapshots(estimate);
      const totals = { kcal: round(estimate.totals.kcal), protein: round(estimate.totals.protein), carbs: round(estimate.totals.carbs), fat: round(estimate.totals.fat) };
      const validated = mealUpdateSchema.parse({ description: row.description, eatenAt: new Date(row.eaten_at).toISOString(), ...totals,
        itemSnapshots: snapshots, provenance: "estimated" });
      const candidate: HistoryRow = { ...row, ...totals, item_snapshots: validated.itemSnapshots, provenance: "estimated" };
      if (historyFingerprint([candidate]) === historyFingerprint([row])) continue;
      candidate.updated_at = new Date(options.updatedAt).toISOString();
      plan.after[index] = candidate; plan.changedIds.push(row.id);
    } catch {
      plan.pending.push({ id: row.id, reason: "invalid_input", components: [] });
    }
  }
  assertHistoryIdentity(plan.before, plan.after);
  return plan;
}

export interface HistoryTransaction {
  readLocked(): Promise<HistoryRow[]>;
  updateNutrition(row: HistoryRow): Promise<void>;
}
/** Call inside a DB transaction. Any mismatch throws before commit. */
export async function applyHistoryPlan(tx: HistoryTransaction, plan: ReestimatePlan, requireAll: boolean): Promise<void> {
  assertHistoryIdentity(plan.before, plan.after);
  if (requireAll && plan.pending.length) throw new Error("All-meal recalculation requires every meal to resolve first");
  if (historyFingerprint(await tx.readLocked()) !== historyFingerprint(plan.before)) throw new Error("Meal history changed since the preview; recalculate before applying");
  const selected = new Set(plan.changedIds);
  if (selected.size !== plan.changedIds.length || plan.changedIds.some((id) => !plan.before.some((row) => row.id === id))) throw new Error("Invalid update identity list");
  for (const row of plan.after) if (selected.has(row.id)) await tx.updateNutrition(row);
  const actual = await tx.readLocked();
  assertHistoryIdentity(plan.before, actual);
  if (historyFingerprint(actual) !== historyFingerprint(plan.after)) throw new Error("Post-update verification failed; transaction must roll back");
}
