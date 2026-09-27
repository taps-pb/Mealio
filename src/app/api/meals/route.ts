import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { findSession } from "@/server/auth/session";
import { acceptsSameOriginMutation } from "@/server/auth/request-origin";
import { createMeal, listMeals } from "@/server/meals/service";
import { mealInputSchema } from "@/server/meals/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const error = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers });

export async function GET() {
  const token = (await cookies()).get("mealio_session")?.value;
  if (!token) return error(401, "Unauthorized");
  try {
    const auth = await findSession(token);
    if (!auth) return error(401, "Unauthorized");
    const result = await listMeals(auth.admin.id, auth.admin.timezone);
    return NextResponse.json(result, { headers });
  } catch {
    return error(503, "Service unavailable");
  }
}

export async function POST(request: NextRequest) {
  if (!acceptsSameOriginMutation(request)) return error(403, "Forbidden");
  const token = request.cookies.get("mealio_session")?.value;
  if (!token) return error(401, "Unauthorized");
  let auth: Awaited<ReturnType<typeof findSession>>;
  try { auth = await findSession(token); }
  catch { return error(503, "Service unavailable"); }
  if (!auth) return error(401, "Unauthorized");

  if (!request.headers.get("content-type")?.startsWith("application/json")) return error(400, "Invalid request");
  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 20000) return error(400, "Invalid request");
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 20000) return error(400, "Invalid request");
    body = JSON.parse(text);
  } catch { return error(400, "Invalid request"); }
  const parsed = mealInputSchema.safeParse(body);
  if (!parsed.success) return error(400, "Invalid request");

  try {
    const result = await createMeal(auth.admin.id, parsed.data);
    if (result.status === "conflict") return error(409, "Idempotency key used for a different meal");
    return NextResponse.json({ meal: result.meal, duplicate: result.status === "duplicate" }, {
      status: result.status === "created" ? 201 : 200, headers,
    });
  } catch { return error(503, "Service unavailable"); }
}
