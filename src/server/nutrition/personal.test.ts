import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@/server/db/client";
import { getCachedResolution, getPortionPreference, putCachedResolution, preferenceKey, resolutionKey, savePortionCorrections } from "./personal";

const item = { name: "apple", quantity: 1, unit: "medium", grams: null, uncertainty: null };
const snapshot = { ...item, grams: 182, kcal: 95, protein: .5, carbs: 25, fat: .3,
  source: "usda" as const, sourceId: "123", uncertainty: "Estimated portion; confirm weight.", matchConfidence: "medium" as const };
const insert = vi.fn(), values = vi.fn(), upsert = vi.fn();
const select = vi.fn(), from = vi.fn(), where = vi.fn(), limit = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  upsert.mockResolvedValue(undefined);
  values.mockReturnValue({ onConflictDoUpdate: upsert });
  insert.mockReturnValue({ values });
  limit.mockResolvedValue([]);
  where.mockReturnValue({ limit }); from.mockReturnValue({ where }); select.mockReturnValue({ from });
  vi.mocked(getDb).mockReturnValue({ insert, select } as unknown as ReturnType<typeof getDb>);
});

describe("private nutrition keys", () => {
  it("keeps brand, preparation, amount and portion context distinct", () => {
    const base = { name: "apple", quantity: 1, unit: "medium", grams: null };
    expect(resolutionKey(base)).not.toBe(resolutionKey({ ...base, name: "grilled apple" }));
    expect(resolutionKey(base)).not.toBe(resolutionKey({ ...base, name: "Brand apple" }));
    expect(resolutionKey(base)).not.toBe(resolutionKey({ ...base, quantity: 2 }));
    expect(resolutionKey(base)).not.toBe(resolutionKey({ ...base, grams: 182 }));
    expect(preferenceKey(base)).toEqual({ foodKey: "apple", unit: "medium" });
    expect(resolutionKey(base)).toContain('"v2"');
  });
  it("only caches validated source-backed matches with expiry; never manual or uncertain low-confidence results", async () => {
    await putCachedResolution("owner", item, snapshot);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ adminId: "owner", expiresAt: expect.any(Date) }));
    expect(upsert).toHaveBeenCalledTimes(1);
    await putCachedResolution("owner", item, { ...snapshot, source: "manual", sourceId: null });
    await putCachedResolution("owner", item, { ...snapshot, matchConfidence: "low" });
    expect(values).toHaveBeenCalledTimes(1);
    limit.mockResolvedValueOnce([{ snapshot }]);
    expect(await getCachedResolution("owner", item)).toMatchObject({ sourceId: "123" });
    limit.mockResolvedValueOnce([{ snapshot: { ...snapshot, source: "manual", sourceId: null } }]);
    expect(await getCachedResolution("owner", item)).toBeNull();
  });
  it("persists only explicitly edited portions and reuses them for equivalent inputs", async () => {
    await savePortionCorrections("owner", [{ ...snapshot }, { ...snapshot, grams: 200, portionEdited: true },
      { ...snapshot, name: "grilled apple", grams: 155 }]);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ foodKey: "apple", unit: "medium", gramsPerUnit: 200 }));
    limit.mockResolvedValueOnce([{ gramsPerUnit: 200 }]);
    expect(await getPortionPreference("owner", item)).toBe(200);
    expect(await getPortionPreference("owner", { ...item, grams: 182 })).toBeNull();
  });
});
