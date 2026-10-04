import { describe, expect, it } from "vitest";
import { createNutritionEngine } from "@/lib/nutrition/runtime";
import { applyHistoryPlan, assertHistoryIdentity, historyFingerprint, planHistoryReestimate, type HistoryRow, type HistoryTransaction } from "./reestimate";

const row = (id = "00000000-0000-4000-8000-000000000011", description = "2 aloo pyaaz paratha"): HistoryRow => ({ id, description,
  admin_id: "00000000-0000-4000-8000-000000000001", eaten_at: "2026-10-03T23:55:00+05:30", created_at: "2026-10-03T18:26:00Z", updated_at: "2026-10-03T18:26:00Z",
  kcal: 999, protein: 99, carbs: 88, fat: 77, item_snapshots: [], provenance: "corrected", idempotency_key: "original-save-key" });
const options = { replaceCorrections: true, updatedAt: "2026-10-04T12:00:00Z" };

describe("explicit non-destructive history recalculation", () => {
  it("updates nutrition and snapshots only, preserving original identity/text/time/save key", () => {
    const original = [row()]; const before = structuredClone(original);
    const plan = planHistoryReestimate(original, createNutritionEngine(), options);
    expect(original).toEqual(before); expect(plan.changedIds).toEqual([original[0].id]); expect(plan.pending).toEqual([]);
    expect(plan.after[0]).toMatchObject({ id: original[0].id, description: original[0].description, eaten_at: original[0].eaten_at, created_at: original[0].created_at, idempotency_key: "original-save-key", provenance: "estimated" });
    expect(plan.after[0].kcal).not.toBe(999);
    expect(plan.after[0].item_snapshots[0].local?.databaseVersion).toBe(plan.databaseVersion);
    expect(() => assertHistoryIdentity(plan.before, plan.after)).not.toThrow();
  });
  it("requires explicit permission to replace corrected meals", () => {
    const plan = planHistoryReestimate([row()], createNutritionEngine(), { ...options, replaceCorrections: false });
    expect(plan.pending[0].reason).toBe("manual_correction"); expect(plan.after).toEqual(plan.before);
  });
  it("never zeros an unknown meal or silently applies only part of an all-meal request", async () => {
    const plan = planHistoryReestimate([row(), row("00000000-0000-4000-8000-000000000012", "unidentified item xyz")], createNutritionEngine(), options);
    expect(plan.pending[0].reason).toBe("unresolved"); expect(plan.after[1]).toEqual(plan.before[1]);
    let writes = 0;
    const tx: HistoryTransaction = { readLocked: async () => plan.before, updateNutrition: async () => { writes++; } };
    await expect(applyHistoryPlan(tx, plan, true)).rejects.toThrow("every meal"); expect(writes).toBe(0);
  });
  it("detects concurrent edits before any updates", async () => {
    const plan = planHistoryReestimate([row()], createNutritionEngine(), options);
    let writes = 0;
    await expect(applyHistoryPlan({ readLocked: async () => [{ ...row(), protein: 7 }], updateNutrition: async () => { writes++; } }, plan, true)).rejects.toThrow("changed since the preview");
    expect(writes).toBe(0);
  });
  it("applies the exact planned rows and can restore the original snapshot without deletion", async () => {
    let stored = [row()];
    const plan = planHistoryReestimate(stored, createNutritionEngine(), options);
    const tx: HistoryTransaction = { readLocked: async () => structuredClone(stored), updateNutrition: async (next) => { stored = stored.map((current) => current.id === next.id ? structuredClone(next) : current); } };
    await applyHistoryPlan(tx, plan, true); expect(historyFingerprint(stored)).toBe(historyFingerprint(plan.after)); expect(stored).toHaveLength(1);
    const repeated = planHistoryReestimate(stored, createNutritionEngine(), { ...options, updatedAt: "2026-10-05T12:00:00Z" });
    expect(repeated.changedIds).toEqual([]);
    await applyHistoryPlan(tx, { ...plan, before: plan.after, after: plan.before }, true);
    expect(stored).toEqual([row()]);
  });
  it("makes a transaction fail if an adapter deletes a row or modifies original meal metadata", async () => {
    const plan = planHistoryReestimate([row()], createNutritionEngine(), options);
    for (const changed of [[], [{ ...plan.after[0], description: "changed original text" }], [{ ...plan.after[0], eaten_at: "2026-10-05T00:00:00Z" }]]) {
      let reads = 0;
      await expect(applyHistoryPlan({ readLocked: async () => ++reads === 1 ? plan.before : changed, updateNutrition: async () => {} }, plan, true)).rejects.toThrow("identities");
    }
  });
  it("fingerprints ignore timestamp notation and object-key ordering, not nutrition changes", () => {
    expect(historyFingerprint([row()])).toBe(historyFingerprint([{ ...row(), eaten_at: "2026-10-03T18:25:00Z" }]));
    expect(historyFingerprint([row()])).not.toBe(historyFingerprint([{ ...row(), carbs: 55 }]));
  });
});
