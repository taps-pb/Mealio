import { describe, expect, it } from "vitest";
import { renderHistoryPdf } from "./history-pdf";
import type { Meal } from "@/server/db/schema";
import type { HistoryGroup, HistoryOptions } from "@/lib/history";

const options: HistoryOptions = { search: "दाल", from: "2026-09-28", through: "2026-09-28", sort: "new" };
const sample: Meal = { id: "00000000-0000-4000-8000-000000000002", adminId: "00000000-0000-4000-8000-000000000001",
  description: "दाल और चावल", eatenAt: new Date("2026-09-28T18:30:00Z"), kcal: 320, protein: 12, carbs: 48, fat: null,
  provenance: "corrected", itemSnapshots: [{ name: "दाल", quantity: 1, unit: "bowl", grams: null, kcal: 320, protein: 12, carbs: 48,
    source: "manual", sourceId: null, uncertainty: "Portion uncertain" }], idempotencyKey: null,
  createdAt: new Date("2026-09-28T18:30:00Z"), updatedAt: new Date("2026-09-28T18:30:00Z") };

describe("private history PDF", () => {
  it("creates a signed-off PDF layout with Unicode meals and warnings", async () => {
    const groups: HistoryGroup<Meal>[] = [{ day: "2026-09-28", meals: [sample], totalKcal: 320, totalProtein: 12, totalCarbs: 48 }];
    const pdf = await renderHistoryPdf(groups, "Asia/Kolkata", options, new Date("2026-09-29T00:00:00Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });
  it("paginates longer filtered history", async () => {
    const groups: HistoryGroup<Meal>[] = [{ day: "2026-09-28", meals: Array.from({ length: 80 }, (_, i) => ({ ...sample, id: String(i).padStart(36, "0") })),
      totalKcal: 25600, totalProtein: 960, totalCarbs: 3840 }];
    const pdf = await renderHistoryPdf(groups, "UTC", options);
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
  it("exports new fat and recipe-assumption snapshots while preserving older nullable rows", async () => {
    const meal: Meal = { ...sample, fat: 12, itemSnapshots: [{
      name: "vegetable biryani", quantity: .5, unit: "plate", grams: 180, kcal: 320, protein: 12, carbs: 48,
      fat: 12, source: "recipe_estimate", sourceId: null, uncertainty: "Hypothetical serving",
      recipeUncertainty: "Oil and rice amounts vary", matchConfidence: "low", assumptions: ["Half plate assumed 180 g"],
      ingredients: [{ name: "cooked rice", grams: 120, kcal: 156, protein: 3, carbs: 34, fat: .3,
        source: "usda", sourceId: "123", uncertainty: null }],
    }] };
    const groups: HistoryGroup<Meal>[] = [{ day: "2026-09-28", meals: [meal, sample], totalKcal: 640, totalProtein: 24, totalCarbs: 96 }];
    const pdf = await renderHistoryPdf(groups, "Asia/Kolkata", options);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
