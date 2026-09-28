import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/request-origin", () => ({ acceptsSameOriginMutation: () => true }));
vi.mock("@/server/auth/session", () => ({ findSession: vi.fn().mockResolvedValue({ id: "owner" }) }));
vi.mock("@/server/nutrition/interpret", () => ({ interpretMeal: vi.fn() }));
vi.mock("@/server/nutrition/indb", () => ({ lookupIndbFood: vi.fn() }));
vi.mock("@/server/nutrition/usda", () => ({ lookupUsdaFood: vi.fn() }));

import { lookupIndbFood } from "@/server/nutrition/indb";
import { interpretMeal } from "@/server/nutrition/interpret";
import { lookupUsdaFood } from "@/server/nutrition/usda";
import { POST } from "./route";

const item = { name: "Roti", quantity: 2, unit: "roti", grams: null, uncertainty: "Check size" };
const request = () => new NextRequest("http://localhost:3000/api/estimate", {
  method: "POST", headers: { Origin: "http://localhost:3000", Cookie: "mealio_session=test" },
  body: JSON.stringify({ description: "2 rotis" }),
});

describe("optional INDB estimate routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(interpretMeal).mockResolvedValue({ ok: true, items: [item] });
  });

  it("returns a visibly uncertain INDB candidate without contacting USDA", async () => {
    vi.mocked(lookupIndbFood).mockResolvedValue({ status: "candidate", sourceId: "TEST001", grams: null,
      nutrients: { kcal: 200, protein: 6, carbs: 32 }, uncertainty: "INDB reference recipe; serving size may differ." });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.items[0]).toMatchObject({ source: "indb", sourceId: "TEST001", grams: null,
      kcal: 200, uncertainty: "INDB reference recipe; serving size may differ." });
    expect(result.totals).toEqual({ kcal: 200, protein: 6, carbs: 32 });
    expect(lookupUsdaFood).not.toHaveBeenCalled();
  });

  it("retains the USDA flow when INDB has no confident match", async () => {
    vi.mocked(lookupIndbFood).mockResolvedValue({ status: "unmatched", uncertainty: "No verified INDB dish and portion match." });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "candidate", sourceId: "123",
      description: "Roti", grams: 100, nutrients: { kcal: 170, protein: 4, carbs: 29 }, uncertainty: "Check portion" });
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.items[0]).toMatchObject({ source: "usda", sourceId: "123", grams: 100, kcal: 170 });
    expect(lookupUsdaFood).toHaveBeenCalledWith(item);
  });

  it("keeps an unknown dish on the manual path instead of inventing nutrients", async () => {
    vi.mocked(lookupIndbFood).mockResolvedValue({ status: "unmatched", uncertainty: "No verified INDB dish and portion match." });
    vi.mocked(lookupUsdaFood).mockResolvedValue({ status: "unmatched", uncertainty: "Portion weight unknown; enter nutrients manually." });
    const response = await POST(request());
    const result = await response.json();
    expect(result.incomplete).toBe(true);
    expect(result.totals).toBeNull();
    expect(result.items[0]).toMatchObject({ source: "unmatched", sourceId: null,
      kcal: null, protein: null, carbs: null });
    expect(result.items[0].uncertainty).toContain("Check size");
  });
});
