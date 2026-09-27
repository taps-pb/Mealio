import { and, eq, sql } from "drizzle-orm";

import { hashPassword } from "../src/server/auth/crypto";
import { getDb } from "../src/server/db/client";
import { admins, sessions } from "../src/server/db/schema";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_NEW_PASSWORD;
  if (!process.env.DATABASE_URL || !username || !/^[a-z0-9._-]{3,64}$/.test(username) ||
      !password || password.length < 12 || password.length > 256) throw new Error("Invalid recovery input");

  const passwordHash = await hashPassword(password);
  await getDb().transaction(async (tx) => {
    const rows = await tx.update(admins).set({
      passwordHash,
      sessionVersion: sql`${admins.sessionVersion} + 1`,
    }).where(and(eq(admins.id, OWNER_ID), eq(admins.username, username)))
      .returning({ id: admins.id });
    if (rows.length !== 1) throw new Error("Owner not found");
    await tx.delete(sessions).where(eq(sessions.adminId, OWNER_ID));
  });
  process.stdout.write("Owner password rotated; old sessions revoked.\n");
}

main().then(
  () => process.exit(0),
  () => {
    // DB failures may include connection URLs. Never print raw exceptions.
    process.stderr.write("Private recovery failed.\n");
    process.exit(1);
  },
);
