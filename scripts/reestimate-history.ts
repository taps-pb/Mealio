import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { createNutritionEngine, foodCatalog } from "../src/lib/nutrition/runtime";
import { emptyUserData } from "../src/lib/nutrition/types";
import { validateUserData } from "../src/lib/nutrition/user-library";
import { applyHistoryPlan, historyFingerprint, planHistoryReestimate, type HistoryRow, type HistoryTransaction, type ReestimatePlan } from "../src/server/meals/reestimate";

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const config = process.env.MEALIO_BACKUP_CONFIG ?? join(homedir(), "Library/Application Support/MealioBackup/private");
const recipient = join(config, "age-recipient.txt"), identity = join(config, "age-identity.txt");
const directory = join(config, "history-reestimates");
const maxBuffer = 128 * 1024 * 1024;

function adapter(tx: postgres.TransactionSql): HistoryTransaction {
  return {
    async readLocked() {
      const records = await tx`select to_jsonb(m) as record from meals m order by id for update`;
      return records.map((entry) => entry.record as HistoryRow);
    },
    async updateNutrition(row) {
      const result = await tx`update meals set kcal=${row.kcal}, protein=${row.protein}, carbs=${row.carbs}, fat=${row.fat},
        item_snapshots=${tx.json(row.item_snapshots as unknown as postgres.JSONValue)}, provenance=${row.provenance}, updated_at=${row.updated_at}
        where id=${row.id} and admin_id=${row.admin_id} returning id`;
      if (result.length !== 1) throw new Error("Expected exactly one existing meal to update");
    },
  };
}
function decrypt(file: string): Buffer {
  const response = spawnSync("age", ["--decrypt", "-i", identity, file], { maxBuffer });
  if (response.status !== 0 || !response.stdout.length) throw new Error("Encrypted revision could not be verified");
  return response.stdout;
}
function archive(plan: ReestimatePlan, library: unknown, time: string): string {
  const payload = Buffer.from(JSON.stringify({ format: "mealio-history-reestimate-v1", createdAt: time, plan, library }));
  const encrypted = spawnSync("age", ["--encrypt", "-R", recipient], { input: payload, maxBuffer });
  if (encrypted.status !== 0 || !encrypted.stdout.length) throw new Error("Could not encrypt the before/after revision; updates cancelled");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${time.replace(/[:.]/g, "-")}-${plan.databaseVersion}.json.age`);
  writeFileSync(file, encrypted.stdout, { flag: "wx", mode: 0o600 });
  writeFileSync(`${file}.sha256`, hash(encrypted.stdout) + "\n", { flag: "wx", mode: 0o600 });
  if (hash(decrypt(file)) !== hash(payload)) throw new Error("Revision decryption mismatch; updates cancelled");
  return file;
}

async function main() {
  const restoreFile = option("--restore");
  if (args.includes("--help")) {
    console.log("Preview: node --env-file=.env.local --import tsx scripts/reestimate-history.ts --library /private/library.json --include-corrected --require-all\nApply: add --apply (writes an encrypted reversible archive before updating)\nUndo: --restore /private/revision.json.age --apply (refuses if history has changed since that revision)"); return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; load it privately with --env-file");
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid database configuration");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const apply = args.includes("--apply");
    if (restoreFile) {
      const encrypted = readFileSync(restoreFile);
      if (hash(encrypted) !== readFileSync(`${restoreFile}.sha256`, "utf8").trim()) throw new Error("Revision checksum mismatch");
      const saved = JSON.parse(decrypt(restoreFile).toString("utf8")) as { format: string; plan: ReestimatePlan };
      if (saved.format !== "mealio-history-reestimate-v1") throw new Error("Unrecognized revision format");
      const reverse = { ...saved.plan, before: saved.plan.after, after: saved.plan.before, pending: [] };
      if (!apply) { console.log(JSON.stringify({ mode: "restore-preview", meals: reverse.changedIds.length })); return; }
      await sql.begin("isolation level serializable", async (tx) => { await tx`set local timezone='UTC'`; await applyHistoryPlan(adapter(tx), reverse, true); });
      console.log(JSON.stringify({ mode: "restored", restoredMeals: reverse.changedIds.length, totalMeals: reverse.after.length })); return;
    }
    const libraryPath = option("--library");
    const library = libraryPath ? validateUserData(JSON.parse(readFileSync(resolve(libraryPath), "utf8")), foodCatalog) : emptyUserData();
    const engine = createNutritionEngine(library);
    const updatedAt = new Date().toISOString();
    const rows = await sql.begin("read only", async (tx) => {
      await tx`set local timezone='UTC'`;
      const result = await tx`select to_jsonb(m) as record from meals m order by id`;
      return result.map((entry) => entry.record as HistoryRow);
    });
    const plan = planHistoryReestimate(rows, engine, { replaceCorrections: args.includes("--include-corrected"), updatedAt });
    const summary = { mode: apply ? "applied" : "preview", databaseVersion: plan.databaseVersion, totalMeals: rows.length,
      updates: plan.changedIds.length, unchanged: rows.length - plan.changedIds.length - plan.pending.length,
      pending: plan.pending.length, pendingReasons: plan.pending.reduce<Record<string, number>>((sum, item) => ({ ...sum, [item.reason]: (sum[item.reason] ?? 0) + 1 }), {}) };
    if (args.includes("--require-all") && plan.pending.length) {
      console.log(JSON.stringify({ ...summary, mode: "blocked" })); throw new Error("Some meals remain unresolved; no changes applied");
    }
    let revision: string | undefined;
    if (apply && plan.changedIds.length) {
      revision = archive(plan, library, updatedAt);
      await sql.begin("isolation level serializable", async (tx) => {
        await tx`set local timezone='UTC'`;
        await applyHistoryPlan(adapter(tx), plan, args.includes("--require-all"));
      });
      writeFileSync(`${revision}.receipt.json`, JSON.stringify({ ...summary, beforeHash: historyFingerprint(plan.before), afterHash: historyFingerprint(plan.after) }) + "\n", { flag: "wx", mode: 0o600 });
    }
    console.log(JSON.stringify({ ...summary, ...(revision ? { encryptedRevision: revision, verifiedRowCount: plan.after.length, identitiesAndTimesPreserved: true } : {}) }, null, 2));
  } finally { await sql.end(); }
}

main().catch(() => {
  // Raw PostgreSQL/validation/child-process errors can contain private records or
  // credentials. Keep the CLI output aggregate-only. Inspect archived revisions
  // locally rather than logging meal text or connection strings.
  console.error("History operation stopped. No unverified transaction was committed. Check flags, local library, credentials and encrypted-backup tools privately.");
  process.exitCode = 1;
});
