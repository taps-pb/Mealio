import { and, eq, gt } from "drizzle-orm";

import { generateSessionToken, hashToken, sessionExpiry } from "./crypto";
import { getDb } from "../db/client";
import { admins, sessions } from "../db/schema";

export type SessionRow = typeof sessions.$inferSelect;
export type AdminRow = typeof admins.$inferSelect;

export function isSessionCurrent(
  session: Pick<SessionRow, "sessionVersion" | "expiresAt">,
  admin: Pick<AdminRow, "sessionVersion">,
  now: Date,
): boolean {
  return session.expiresAt.getTime() > now.getTime() && session.sessionVersion === admin.sessionVersion;
}

export async function createSession(adminId: string, sessionVersion: number): Promise<string> {
  const token = generateSessionToken();
  await getDb().insert(sessions).values({
    tokenHash: hashToken(token), adminId, sessionVersion, expiresAt: sessionExpiry(),
  });
  return token;
}

export async function findSession(token: string): Promise<{ session: SessionRow; admin: AdminRow } | null> {
  if (!token) return null;
  const now = new Date();
  const rows = await getDb()
    .select({ session: sessions, admin: admins })
    .from(sessions)
    .innerJoin(admins, eq(sessions.adminId, admins.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  return row && isSessionCurrent(row.session, row.admin, now) ? row : null;
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeAllSessions(adminId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.adminId, adminId));
}
