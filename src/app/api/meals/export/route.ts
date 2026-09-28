import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { filterAndSortHistory, historyTotals, isValidDay, type HistoryOptions, type HistorySort } from "@/lib/history";
import { findSession } from "@/server/auth/session";
import { listMeals } from "@/server/meals/service";
import { renderHistoryPdf } from "@/server/meals/history-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const error = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers });
const sorts: HistorySort[] = ["new", "old", "kcal-desc", "kcal-asc"];

function parseOptions(params: URLSearchParams): HistoryOptions | null {
  if ([...params.keys()].some((key) => !["search", "from", "through", "sort"].includes(key) || params.getAll(key).length !== 1)) return null;
  const search = params.get("search") ?? "";
  const from = params.get("from") ?? "";
  const through = params.get("through") ?? "";
  const sort = params.get("sort") ?? "new";
  if (search.length > 100 || (from && !isValidDay(from)) || (through && !isValidDay(through)) ||
      (from && through && from > through) || !sorts.includes(sort as HistorySort)) return null;
  return { search: search.trim(), from, through, sort: sort as HistorySort };
}

export async function GET(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return error(403, "Forbidden");
  const token = (await cookies()).get("mealio_session")?.value;
  if (!token) return error(401, "Unauthorized");
  try {
    const auth = await findSession(token);
    if (!auth) return error(401, "Unauthorized");
    const options = parseOptions(request.nextUrl.searchParams);
    if (!options) return error(400, "Invalid history filters");
    const { groups } = await listMeals(auth.admin.id, auth.admin.timezone);
    const visible = filterAndSortHistory(groups, options);
    const count = historyTotals(visible).count;
    if (!count) return error(404, "No matching meals to export");
    if (count > 3000) return error(413, "Choose a narrower date range to export");
    const pdf = await renderHistoryPdf(visible, auth.admin.timezone, options);
    if (pdf.length > 25 * 1024 * 1024) return error(413, "Choose a narrower date range to export");
    return new NextResponse(new Uint8Array(pdf), { headers: { ...headers,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Mealio-history.pdf"',
      "Content-Length": String(pdf.length),
      "Cross-Origin-Resource-Policy": "same-origin",
    } });
  } catch {
    // Database/PDF errors can contain private data or connection strings.
    return error(503, "Export unavailable. Try again later.");
  }
}
