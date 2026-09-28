import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ findSession: vi.fn() }));
vi.mock("@/server/meals/service", () => ({ listMeals: vi.fn() }));
vi.mock("@/server/meals/history-pdf", () => ({ renderHistoryPdf: vi.fn() }));

import { findSession } from "@/server/auth/session";
import { listMeals } from "@/server/meals/service";
import { renderHistoryPdf } from "@/server/meals/history-pdf";
import { GET } from "./route";

const request = (query = "") => new NextRequest(`https://mealio.test/api/meals/export${query}`);
const meals = [
  { id: "a", description: "Paneer roti", eatenAt: new Date("2026-09-28T13:00:00Z"), kcal: 400, protein: 20, carbs: 40 },
  { id: "b", description: "Tea", eatenAt: new Date("2026-09-28T14:00:00Z"), kcal: 20, protein: 0, carbs: 3 },
];

describe("private PDF export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "session" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(findSession).mockResolvedValue({ admin: { id: "owner", timezone: "Asia/Kolkata" } } as Awaited<ReturnType<typeof findSession>>);
    vi.mocked(listMeals).mockResolvedValue({ todayKey: "2026-09-28", groups: [{ day: "2026-09-28", meals,
      totalKcal: 420, totalProtein: 20, totalCarbs: 43 }] } as Awaited<ReturnType<typeof listMeals>>);
    vi.mocked(renderHistoryPdf).mockResolvedValue(Buffer.from("%PDF-test"));
  });

  it("denies access without an owner session", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as unknown as Awaited<ReturnType<typeof cookies>>);
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(listMeals).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects cross-site export navigation", async () => {
    const crossSite = new NextRequest("https://mealio.test/api/meals/export", { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect((await GET(crossSite)).status).toBe(403);
    expect(listMeals).not.toHaveBeenCalled();
  });

  it("rejects invalid date ranges and duplicate query keys", async () => {
    expect((await GET(request("?from=2026-09-28&through=2026-09-27"))).status).toBe(400);
    expect((await GET(request("?search=a&search=b"))).status).toBe(400);
    expect(listMeals).not.toHaveBeenCalled();
  });

  it("exports only matching meals with recalculated totals and owner timezone", async () => {
    const result = await GET(request("?search=paneer&from=2026-09-28&through=2026-09-28&sort=new"));
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("application/pdf");
    expect(result.headers.get("content-disposition")).toContain("attachment");
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(listMeals).toHaveBeenCalledWith("owner", "Asia/Kolkata");
    const filtered = vi.mocked(renderHistoryPdf).mock.calls[0][0];
    expect(filtered[0].meals.map((meal) => meal.description)).toEqual(["Paneer roti"]);
    expect(filtered[0].totalKcal).toBe(400);
    expect(vi.mocked(renderHistoryPdf).mock.calls[0][1]).toBe("Asia/Kolkata");
  });
});
