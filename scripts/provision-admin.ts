import { hashPassword } from "../src/server/auth/crypto";
import { getDb } from "../src/server/db/client";
import { admins } from "../src/server/db/schema";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const USERNAME = /^[a-z0-9._-]{3,64}$/;

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const timezone = process.env.ADMIN_TIMEZONE;
  if (!process.env.DATABASE_URL || !username || !password || !timezone ||
      !USERNAME.test(username) || password.length < 12 || password.length > 256 ||
      !validTimezone(timezone)) {
    throw new Error("invalid configuration");
  }

  const db = getDb();
  if ((await db.select({ id: admins.id }).from(admins).limit(1)).length) {
    throw new Error("already provisioned");
  }

  // The fixed primary key makes two concurrent invocations unable to create
  // two owners, even if both observed an empty table before the insert.
  const rows = await db.insert(admins).values({
    id: OWNER_ID,
    username,
    passwordHash: await hashPassword(password),
    timezone,
  }).onConflictDoNothing({ target: admins.id }).returning({ id: admins.id });
  if (rows.length !== 1) throw new Error("already provisioned");
  process.stdout.write("Admin created.\n");
}

main().then(
  () => process.exit(0),
  () => {
    // Database errors can contain connection strings; never print them.
    process.stderr.write("Provisioning failed. Check private configuration or existing account.\n");
    process.exit(1);
  },
);
