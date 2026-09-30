import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is missing from .env.local");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
});
