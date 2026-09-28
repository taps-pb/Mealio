import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { indbCatalogs } from "../src/server/db/schema";
import { parseIndbCatalog, type IndbRecord } from "../src/server/nutrition/indb";

const MAX_BYTES = 5_000_000;
const CATALOG_ID = "private";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function parseImportArgs(args: string[]): { replace: boolean } | null {
  if (!args.includes("--confirm-private-upload") ||
      args.some((arg) => !["--confirm-private-upload", "--replace"].includes(arg)) ||
      new Set(args).size !== args.length) return null;
  return { replace: args.includes("--replace") };
}

/** Reads only the ignored private export; neither the workbook nor its contents are logged. */
export async function readPrivateCatalog(root = ROOT): Promise<IndbRecord[] | null> {
  try {
    const file = join(root, "dataset", "indb-private.json");
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) return null;
    const data = await readFile(file);
    if (data.byteLength > MAX_BYTES) return null;
    return parseIndbCatalog(JSON.parse(data.toString("utf8")));
  } catch {
    return null;
  }
}

async function importCatalog(url: string, records: IndbRecord[], replace: boolean): Promise<boolean> {
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    const db = drizzle(client);
    if (replace) {
      await db.insert(indbCatalogs).values({ id: CATALOG_ID, records })
        .onConflictDoUpdate({ target: indbCatalogs.id, set: { records, updatedAt: new Date() } });
      return true;
    }
    const inserted = await db.insert(indbCatalogs).values({ id: CATALOG_ID, records })
      .onConflictDoNothing().returning({ id: indbCatalogs.id });
    return inserted.length === 1;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const options = parseImportArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!options || !url) throw new Error("private import prerequisites missing");
  const records = await readPrivateCatalog();
  if (!records) throw new Error("private catalog invalid or unavailable");
  if (!await importCatalog(url, records, options.replace)) throw new Error("catalog already present; use --replace only after review");
  process.stdout.write("Private catalog imported. No record contents were printed.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Drivers can include URLs in errors; never print exception details.
    process.stderr.write("Private import refused or failed. Check confirmation, file, migration and database privately.\n");
    process.exitCode = 1;
  });
}
