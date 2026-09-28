CREATE TABLE "indb_catalogs" (
	"id" text PRIMARY KEY NOT NULL,
	"records" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
