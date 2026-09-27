import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { findSession } from "@/server/auth/session";
import { acceptsSameOriginMutation } from "@/server/auth/request-origin";
import { deleteMeal, updateMeal } from "@/server/meals/service";
import { mealUpdateSchema } from "@/server/meals/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const error = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers });
type Context = { params: Promise<{ id: string }> };

async function authorize(request: NextRequest) {
  const token = request.cookies.get("mealio_session")?.value;
  if (!token) return { status: "unauthorized" as const };
  try {
    const auth = await findSession(token);
    return auth ? { status: "ok" as const, id: auth.admin.id } : { status: "unauthorized" as const };
  } catch { return { status: "unavailable" as const }; }
}

export async function PUT(request: NextRequest, context: Context) {
  if (!acceptsSameOriginMutation(request)) return error(403, "Forbidden");
  const auth = await authorize(request);
  if (auth.status !== "ok") return error(auth.status === "unavailable" ? 503 : 401, auth.status === "unavailable" ? "Service unavailable" : "Unauthorized");
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return error(400, "Invalid meal ID");
  if (!request.headers.get("content-type")?.startsWith("application/json")) return error(400, "Invalid request");
  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 20000) return error(400, "Invalid request");
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 20000) return error(400, "Invalid request");
    body = JSON.parse(text);
  } catch { return error(400, "Invalid request"); }
  const parsed = mealUpdateSchema.safeParse(body);
  if (!parsed.success) return error(400, "Invalid request");
  try {
    const meal = await updateMeal(auth.id, id, parsed.data);
    return meal ? NextResponse.json({ meal }, { headers }) : error(404, "Meal not found");
  } catch { return error(503, "Service unavailable"); }
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!acceptsSameOriginMutation(request)) return error(403, "Forbidden");
  const auth = await authorize(request);
  if (auth.status !== "ok") return error(auth.status === "unavailable" ? 503 : 401, auth.status === "unavailable" ? "Service unavailable" : "Unauthorized");
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return error(400, "Invalid meal ID");
  try {
    return await deleteMeal(auth.id, id)
      ? new NextResponse(null, { status: 204, headers })
      : error(404, "Meal not found");
  } catch { return error(503, "Service unavailable"); }
}
