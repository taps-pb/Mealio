import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const admins = pgTable("admins", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  sessionVersion: integer("session_version").notNull().default(0),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("admins_single_owner_id", sql`${table.id} = '00000000-0000-4000-8000-000000000001'::uuid`),
]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  adminId: uuid("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  sessionVersion: integer("session_version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type MealItemSnapshot = {
  name: string;
  quantity: number | null;
  unit: string | null;
  grams: number | null;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat?: number | null;
  fiber?: number | null;
  sugar?: number | null;
  source: "usda" | "indb" | "manual" | "unmatched" | "recipe_estimate";
  sourceId: string | null;
  uncertainty: string | null;
  assumptions?: string[];
  matchConfidence?: "high" | "medium" | "low";
  portionUncertainty?: string | null;
  recipeUncertainty?: string | null;
  per100g?: { kcal: number; protein: number; carbs: number; fat: number | null; fiber: number | null; sugar: number | null } | null;
  portionEdited?: boolean;
  ingredients?: { name: string; grams: number; kcal: number | null; protein: number | null; carbs: number | null;
    fat: number | null; source: "usda" | "indb" | "manual" | "unmatched"; sourceId: string | null; uncertainty: string | null }[];
};

export const mealProvenance = pgEnum("meal_provenance", ["manual", "estimated", "corrected"]);

export const meals = pgTable("meals", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  eatenAt: timestamp("eaten_at", { withTimezone: true }).notNull(),
  kcal: numeric("kcal", { precision: 10, scale: 2, mode: "number" }).notNull(),
  protein: numeric("protein", { precision: 10, scale: 2, mode: "number" }).notNull(),
  carbs: numeric("carbs", { precision: 10, scale: 2, mode: "number" }).notNull(),
  fat: numeric("fat", { precision: 10, scale: 2, mode: "number" }),
  itemSnapshots: jsonb("item_snapshots").$type<MealItemSnapshot[]>().notNull(),
  provenance: mealProvenance("provenance").notNull(),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("meals_admin_eaten_at_idx").on(table.adminId, table.eatenAt),
  uniqueIndex("meals_admin_idempotency_idx").on(table.adminId, table.idempotencyKey),
  check("meals_nonnegative_macros", sql`${table.kcal} >= 0 AND ${table.protein} >= 0 AND ${table.carbs} >= 0`),
]);

export type Meal = typeof meals.$inferSelect;
export type NewMeal = typeof meals.$inferInsert;

export const nutritionCache = pgTable("nutrition_cache", {
  adminId: uuid("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  snapshot: jsonb("snapshot").$type<MealItemSnapshot>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.adminId, table.key] }), index("nutrition_cache_expiry_idx").on(table.expiresAt)]);

export const portionPreferences = pgTable("portion_preferences", {
  adminId: uuid("admin_id").notNull().references(() => admins.id, { onDelete: "cascade" }),
  foodKey: text("food_key").notNull(),
  unit: text("unit").notNull(),
  gramsPerUnit: numeric("grams_per_unit", { precision: 10, scale: 2, mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.adminId, table.foodKey, table.unit] })]);

// Private server-side catalog. No workbook or recipe data is shipped in Git.
export const indbCatalogs = pgTable("indb_catalogs", {
  id: text("id").primaryKey(),
  records: jsonb("records").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
