import { z } from "zod";

const macro = z.number().finite().min(0).max(99_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two decimal places");

const snapshot = z.strictObject({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().nullable(),
  unit: z.string().trim().min(1).max(50).nullable(),
  grams: z.number().finite().positive().nullable(),
  kcal: macro.nullable(), protein: macro.nullable(), carbs: macro.nullable(),
  source: z.enum(["usda", "indb", "manual", "unmatched"]),
  sourceId: z.string().min(1).max(80).nullable(),
  uncertainty: z.string().trim().min(1).max(500).nullable(),
}).superRefine((item, context) => {
  if ((item.source === "usda" || item.source === "indb") && !item.sourceId) context.addIssue({ code: "custom", path: ["sourceId"], message: "Catalog source requires an ID" });
  if ((item.source === "manual" || item.source === "unmatched") && item.sourceId) context.addIssue({ code: "custom", path: ["sourceId"], message: "Manual or unmatched items cannot have a source ID" });
  if (item.source === "indb" && !item.uncertainty) context.addIssue({ code: "custom", path: ["uncertainty"], message: "INDB recipe requires a review note" });
  if (item.source === "unmatched" && !item.uncertainty) context.addIssue({ code: "custom", path: ["uncertainty"], message: "Unmatched food must be marked uncertain" });
});

const base = z.strictObject({
  description: z.string().trim().min(1).max(500),
  eatenAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  kcal: macro, protein: macro, carbs: macro,
  itemSnapshots: z.array(snapshot).max(20),
  provenance: z.enum(["manual", "estimated", "corrected"]),
});

export const mealInputSchema = base.extend({ idempotencyKey: z.uuid() });
export const mealUpdateSchema = base;
export type MealInput = z.infer<typeof mealInputSchema>;
export type MealUpdate = z.infer<typeof mealUpdateSchema>;
