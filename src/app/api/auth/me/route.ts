import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { findSession } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const token = (await cookies()).get("mealio_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  try {
    const result = await findSession(token);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
    return NextResponse.json({
      username: result.admin.username,
      timezone: result.admin.timezone,
    }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: noStore });
  }
}
