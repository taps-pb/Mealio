import { z } from "zod";

const macro = z.number().finite().min(0).max(99_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two decimal places");
const note = z.string().trim().min(1).max(500);
const ingredient = z.strictObject({ name: z.string().trim().min(1).max(200), grams: z.number().finite().positive().max(10000),
  kcal: macro.nullable(), protein: macro.nullable(), carbs: macro.nullable(), fat: macro.nullable(),
  source: z.enum(["usda", "indb", "manual", "unmatched", "estimated"]), sourceId: z.string().min(1).max(80).nullable(),
  uncertainty: note.nullable() });
const per100g = z.strictObject({ kcal: macro, protein: macro, carbs: macro,
  fat: macro.nullable(), fiber: macro.nullable(), sugar: macro.nullable() });

export const snapshotSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive().nullable(),
  unit: z.string().trim().min(1).max(50).nullable(),
  grams: z.number().finite().positive().nullable(),
  kcal: macro.nullable(), protein: macro.nullable(), carbs: macro.nullable(),
  fat: macro.nullable().optional(), fiber: macro.nullable().optional(), sugar: macro.nullable().optional(),
  source: z.enum(["usda", "indb", "manual", "unmatched", "recipe_estimate", "estimated"]),
  sourceId: z.string().min(1).max(80).nullable(),
  uncertainty: z.string().trim().min(1).max(500).nullable(),
  assumptions: z.array(note).max(12).optional(),
  matchConfidence: z.enum(["high", "medium", "low"]).optional(),
  portionUncertainty: note.nullable().optional(), recipeUncertainty: note.nullable().optional(),
  per100g: per100g.nullable().optional(), portionEdited: z.boolean().optional(),
  ingredients: z.array(ingredient).max(12).optional(),
}).superRefine((item, context) => {
  if ((item.source === "usda" || item.source === "indb") && !item.sourceId) context.addIssue({ code: "custom", path: ["sourceId"], message: "Catalog source requires an ID" });
  if ((item.source === "manual" || item.source === "unmatched" || item.source === "recipe_estimate" || item.source === "estimated") && item.sourceId) context.addIssue({ code: "custom", path: ["sourceId"], message: "Unreferenced items cannot have a source ID" });
  if (item.source === "indb" && !item.uncertainty) context.addIssue({ code: "custom", path: ["uncertainty"], message: "INDB recipe requires a review note" });
  if (item.source === "unmatched" && !item.uncertainty) context.addIssue({ code: "custom", path: ["uncertainty"], message: "Unmatched food must be marked uncertain" });
  if (item.source === "recipe_estimate" && (!item.uncertainty || !item.ingredients?.length || !item.recipeUncertainty))
    context.addIssue({ code: "custom", path: ["ingredients"], message: "Recipe must list ingredients and uncertainty" });
});

const base = z.strictObject({
  description: z.string().trim().min(1).max(500),
  eatenAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  kcal: macro, protein: macro, carbs: macro,
  fat: macro.nullable().optional(),
  itemSnapshots: z.array(snapshotSchema).max(20),
  provenance: z.enum(["manual", "estimated", "corrected"]),
});

export const mealInputSchema = base.extend({ idempotencyKey: z.uuid() });
export const mealUpdateSchema = base;
export type MealInput = z.infer<typeof mealInputSchema>;
export type MealUpdate = z.infer<typeof mealUpdateSchema>;
