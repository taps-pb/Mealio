import { NextRequest, NextResponse } from "next/server";

import { revokeSession } from "@/server/auth/session";
import { acceptsSameOriginMutation } from "@/server/auth/request-origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!acceptsSameOriginMutation(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const token = request.cookies.get("mealio_session")?.value;
  try {
    if (token) await revokeSession(token);
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("mealio_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
