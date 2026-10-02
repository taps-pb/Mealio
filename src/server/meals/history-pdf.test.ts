import { describe, expect, it } from "vitest";
import { PdfDayOverflowError, renderHistoryPdf } from "./history-pdf";
import type { Meal } from "@/server/db/schema";
import type { HistoryGroup, HistoryOptions } from "@/lib/history";

const options: HistoryOptions = { search: "दाल", from: "2026-09-28", through: "2026-09-28", sort: "new" };
const sample: Meal = { id: "00000000-0000-4000-8000-000000000002", adminId: "00000000-0000-4000-8000-000000000001",
  description: "दाल और चावल", eatenAt: new Date("2026-09-28T18:30:00Z"), kcal: 320, protein: 12, carbs: 48, fat: null,
  provenance: "corrected", itemSnapshots: [{ name: "दाल", quantity: 1, unit: "bowl", grams: null, kcal: 320, protein: 12, carbs: 48,
    source: "manual", sourceId: null, uncertainty: "Portion uncertain" }], idempotencyKey: null,
  createdAt: new Date("2026-09-28T18:30:00Z"), updatedAt: new Date("2026-09-28T18:30:00Z") };

describe("private history PDF", () => {
  it("creates a diary PDF for a Unicode meal with only the requested public-facing fields", async () => {
    const groups: HistoryGroup<Meal>[] = [{ day: "2026-09-28", meals: [sample], totalKcal: 320, totalProtein: 12, totalCarbs: 48 }];
    const pdf = await renderHistoryPdf(groups, "Asia/Kolkata", options, new Date("2026-09-29T00:00:00Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });
  it("allocates exactly one page per date, even across 20+ meals", async () => {
    const groups: HistoryGroup<Meal>[] = Array.from({ length: 7 }, (_, day) => ({
      day: `2026-09-${String(28 - day).padStart(2, "0")}`,
      meals: Array.from({ length: 4 }, (_, i) => ({ ...sample, id: `meal-${day}-${i}`,
        description: i === 2 ? "paneer and sabzi with roti" : "दाल और चावल" })),
      totalKcal: 1280, totalProtein: 48, totalCarbs: 192,
    }));
    const pdf = await renderHistoryPdf(groups, "Asia/Kolkata", options);
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(7);
  });
  it("fails explicitly rather than splitting, shrinking excessively, or dropping meals from an overloaded day", async () => {
    const meals = Array.from({ length: 35 }, (_, i) => ({ ...sample, id: `meal-${i}`, description: "Aloo paratha" }));
    await expect(renderHistoryPdf([{ day: "2026-09-28", meals, totalKcal: 11_200,
      totalProtein: 420, totalCarbs: 1680 }], "Asia/Kolkata", options)).rejects.toBeInstanceOf(PdfDayOverflowError);
  });
  it("packs a busy but short-description day onto its single page", async () => {
    const meals = Array.from({ length: 12 }, (_, i) => ({ ...sample, id: `meal-${i}`, description: "Aloo paratha" }));
    const pdf = await renderHistoryPdf([{ day: "2026-09-28", meals, totalKcal: 3840,
      totalProtein: 144, totalCarbs: 576 }], "Asia/Kolkata", options);
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });
  it("ignores extra nutrition and recipe data when creating the PDF", async () => {
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
  it("preserves a multiline saved description without splitting a normally sized day", async () => {
    const meal = { ...sample, description: ("paneer\nwith rice\tand dal ").repeat(10).slice(0, 240) };
    const pdf = await renderHistoryPdf([{ day: "2026-09-28", meals: [meal], totalKcal: meal.kcal,
      totalProtein: meal.protein, totalCarbs: meal.carbs }], "Asia/Kolkata", options);
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });
  it("fits large calorie labels and midnight/noon meals on separate dated pages", async () => {
    const groups: HistoryGroup<Meal>[] = [
      { day: "2026-10-02", meals: [
        { ...sample, id: "midnight", description: "Midnight poha", eatenAt: new Date("2026-10-01T18:30:00Z"), kcal: 12_450 },
        { ...sample, id: "noon", description: "Noon idli", eatenAt: new Date("2026-10-02T06:30:00Z"), kcal: 99_999_999.99 },
      ], totalKcal: 100_012_449.99, totalProtein: 0, totalCarbs: 0 },
      { day: "2026-10-01", meals: [{ ...sample, id: "previous" }], totalKcal: 320, totalProtein: 12, totalCarbs: 48 },
    ];
    const pdf = await renderHistoryPdf(groups, "Asia/Kolkata", options);
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(2);
  });
});
