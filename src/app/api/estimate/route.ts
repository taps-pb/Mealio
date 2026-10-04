import { NextResponse } from "next/server";

/** Retired: food text is parsed in the device-local engine, never on an AI/API route. */
export function POST() {
  return NextResponse.json({ error: "Server estimation retired. Refresh Mealio to use the offline estimator." },
    { status: 410, headers: { "Cache-Control": "no-store" } });
}
