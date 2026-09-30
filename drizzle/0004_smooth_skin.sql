CREATE TABLE "nutrition_cache" (
	"admin_id" uuid NOT NULL,
	"key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "nutrition_cache_admin_id_key_pk" PRIMARY KEY("admin_id","key")
);
--> statement-breakpoint
CREATE TABLE "portion_preferences" (
	"admin_id" uuid NOT NULL,
	"food_key" text NOT NULL,
	"unit" text NOT NULL,
	"grams_per_unit" numeric(10, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portion_preferences_admin_id_food_key_unit_pk" PRIMARY KEY("admin_id","food_key","unit")
);
--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "fat" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "nutrition_cache" ADD CONSTRAINT "nutrition_cache_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portion_preferences" ADD CONSTRAINT "portion_preferences_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nutrition_cache_expiry_idx" ON "nutrition_cache" USING btree ("expires_at");