CREATE TYPE "public"."meal_provenance" AS ENUM('manual', 'estimated', 'corrected');--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"description" text NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"kcal" numeric(10, 2) NOT NULL,
	"protein" numeric(10, 2) NOT NULL,
	"carbs" numeric(10, 2) NOT NULL,
	"item_snapshots" jsonb NOT NULL,
	"provenance" "meal_provenance" NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meals_nonnegative_macros" CHECK ("meals"."kcal" >= 0 AND "meals"."protein" >= 0 AND "meals"."carbs" >= 0)
);
--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meals_admin_eaten_at_idx" ON "meals" USING btree ("admin_id","eaten_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meals_admin_idempotency_idx" ON "meals" USING btree ("admin_id","idempotency_key");