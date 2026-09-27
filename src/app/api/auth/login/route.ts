import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyPassword } from "@/server/auth/crypto";
import { acceptsSameOriginMutation } from "@/server/auth/request-origin";
import { isLoginBlocked, nextLoginFailure } from "@/server/auth/rate-limit";
import { createSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { admins, loginAttempts } from "@/server/db/schema";

export const runtime = "nodejs";

const RATE_KEY = "owner-login";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const loginSchema = z.strictObject({
  username: z.string().min(3).max(64),
  password: z.string().min(1).max(256),
});

function unauthorized() {
  return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
}

export async function POST(request: Request) {
  if (!acceptsSameOriginMutation(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return unauthorized();
    body = JSON.parse(raw);
  } catch {
    return unauthorized();
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return unauthorized();

  try {
    const { password } = parsed.data;
    const username = parsed.data.username.toLowerCase();
    const result = await getDb().transaction(async (tx) => {
      // A global bucket is intentional for this one-account site. The lock
      // serializes checks and updates even when many server instances run.
      await tx.execute(sql`select pg_advisory_xact_lock(42078421)`);
      const [bucket] = await tx.select().from(loginAttempts)
        .where(eq(loginAttempts.key, RATE_KEY)).limit(1);
      const now = new Date();
      if (isLoginBlocked(bucket, now)) return null;

      const [admin] = await tx.select({
        id: admins.id, passwordHash: admins.passwordHash,
        sessionVersion: admins.sessionVersion,
      }).from(admins).where(eq(admins.username, username)).limit(1);
      if (admin && await verifyPassword(password, admin.passwordHash)) {
        if (bucket) await tx.delete(loginAttempts).where(eq(loginAttempts.key, RATE_KEY));
        return admin;
      }

      const next = nextLoginFailure(bucket, now);
      if (bucket) {
        await tx.update(loginAttempts).set(next)
          .where(eq(loginAttempts.key, RATE_KEY));
      } else {
        await tx.insert(loginAttempts).values({ key: RATE_KEY, ...next });
      }
      return null;
    });
    if (!result) return unauthorized();

    const token = await createSession(result.id, result.sessionVersion);
    const response = NextResponse.json({ ok: true });
    response.cookies.set("mealio_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch {
    // Database exceptions can include connection details; do not return them.
    return NextResponse.json({ error: "Login temporarily unavailable" }, { status: 503 });
  }
}
