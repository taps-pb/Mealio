import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "../db/client";
import type { InterpretedItem } from "./interpret";
import { lookupIndbFood, matchIndbFood, parseIndbCatalog, resetIndbDatabaseCacheForTests, type IndbRecord } from "./indb";

// Synthetic values only; no INDB nutrient values are copied into the repository.
const roti: IndbRecord = { sourceId: "TEST001", name: "Chapati/Roti", kcalPer100g: 250,
  proteinPer100g: 8, carbsPer100g: 44, servingUnit: "chapati",
  servingKcal: 100, servingProtein: 3.2, servingCarbs: 17.6 };
const poha: IndbRecord = { sourceId: "TEST002", name: "Poha", kcalPer100g: 120,
  proteinPer100g: 4, carbsPer100g: 20, servingUnit: "bowl",
  servingKcal: 180, servingProtein: 6, servingCarbs: 30 };
const idli: IndbRecord = { sourceId: "TEST003", name: "Idli", kcalPer100g: 140,
  proteinPer100g: 6, carbsPer100g: 25, servingUnit: "idli",
  servingKcal: 70, servingProtein: 3, servingCarbs: 12.5 };
const paneerCurry: IndbRecord = { sourceId: "TEST004", name: "Paneer curry", kcalPer100g: 160,
  proteinPer100g: 7, carbsPer100g: 12, servingUnit: "bowl",
  servingKcal: 240, servingProtein: 10.5, servingCarbs: 18 };
const cashewSweet: IndbRecord = { sourceId: "TEST006", name: "Cashewnut burfi (Kaju burfi/Kaju katli)", kcalPer100g: 200,
  proteinPer100g: 5, carbsPer100g: 20, servingUnit: "burfi",
  servingKcal: 100, servingProtein: 2.5, servingCarbs: 10 };
const item = (name: string, quantity: number | null, unit: string | null, grams: number | null): InterpretedItem =>
  ({ name, quantity, unit, grams, uncertainty: null });

describe("private INDB lookup", () => {
  it("matches an exact dish in grams or explicit standard servings", () => {
    expect(matchIndbFood(item("Roti", null, null, 50), [roti])).toMatchObject({
      status: "candidate", sourceId: "TEST001", grams: 50, nutrients: { kcal: 125, protein: 4, carbs: 22 },
    });
    expect(matchIndbFood(item("rotis", 2, "rotis", null), [roti])).toMatchObject({
      status: "candidate", grams: null, nutrients: { kcal: 200, protein: 6.4, carbs: 35.2 },
    });
    expect(matchIndbFood(item("roti", 2, "piece", null), [roti])).toMatchObject({
      status: "candidate", nutrients: { kcal: 200, protein: 6.4, carbs: 35.2 },
    });
    expect(matchIndbFood(item("roti", 3, null, null), [roti])).toMatchObject({
      status: "candidate", nutrients: { kcal: 300, protein: 9.6, carbs: 52.8 },
    });
    expect(matchIndbFood(item("poha", 1, "bowl", null), [poha])).toMatchObject({
      status: "candidate", nutrients: { kcal: 180, protein: 6, carbs: 30 },
    });
    expect(matchIndbFood(item("idlis", 2, "idlis", null), [idli])).toMatchObject({
      status: "candidate", nutrients: { kcal: 140, protein: 6, carbs: 25 },
    });
    expect(matchIndbFood(item("idli", 2, "each", null), [idli]).status).toBe("candidate");
    expect(matchIndbFood(item("idli", 2, null, null), [idli]).status).toBe("candidate");
    expect(matchIndbFood(item("paneer curry", 1, "bowl", null), [paneerCurry]).status).toBe("candidate");
    expect(matchIndbFood(item("kaju burfi", null, null, 50), [cashewSweet])).toMatchObject({
      status: "candidate", sourceId: "TEST006", nutrients: { kcal: 100, protein: 2.5, carbs: 10 },
    });
    expect(matchIndbFood(item("kaju katli", 2, "pieces", null), [cashewSweet])).toMatchObject({
      status: "candidate", sourceId: "TEST006", nutrients: { kcal: 200, protein: 5, carbs: 20 },
      uncertainty: expect.stringContaining("confirm your portion"),
    });
  });

  it("rejects ambiguous, unknown, mismatched, and implausible portions", () => {
    expect(matchIndbFood(item("roti", 1, "plate", null), [roti]).status).toBe("unmatched");
    expect(matchIndbFood(item("poha", 1, "piece", null), [poha]).status).toBe("unmatched");
    expect(matchIndbFood(item("poha", 1, null, null), [poha])).toMatchObject({ status: "unmatched", reason: "portion_missing" });
    expect(matchIndbFood(item("roti", null, null, null), [roti])).toMatchObject({ status: "unmatched", reason: "portion_missing" });
    expect(matchIndbFood(item("roti", 1, "roti", null), [roti, { ...roti, sourceId: "TEST005" }])).toMatchObject({ status: "unmatched", reason: "no_match" });
    expect(matchIndbFood(item("paneer curry", null, null, null), [paneerCurry])).toMatchObject({
      status: "unmatched", reason: "portion_missing",
      uncertainty: expect.stringContaining("1 bowl paneer curry"),
    });
    expect(matchIndbFood(item("paneer curry", 1, null, null), [paneerCurry])).toMatchObject({ status: "unmatched", reason: "portion_missing" });
    expect(matchIndbFood(item("unknown dish", null, null, null), [paneerCurry])).toMatchObject({ status: "unmatched", reason: "no_match" });
    expect(matchIndbFood(item("kaju katli", null, null, null), [cashewSweet])).toMatchObject({
      status: "unmatched", reason: "portion_missing", uncertainty: expect.stringContaining("1 piece kaju katli"),
    });
    expect(matchIndbFood(item("kaju burfi", null, null, null), [cashewSweet])).toMatchObject({ status: "unmatched", reason: "portion_missing" });
    expect(matchIndbFood(item("kaju katli", 2, "plate", null), [cashewSweet]).status).toBe("unmatched");
    expect(matchIndbFood(item("burfi", 1, "piece", null), [cashewSweet,
      { ...cashewSweet, sourceId: "TEST007", name: "Plain burfi (Burfi)" }])).toMatchObject({ status: "unmatched", reason: "no_match" });
    expect(matchIndbFood(item("kaju katli", 2, "pieces", null), [cashewSweet,
      { ...cashewSweet, sourceId: "TEST008" }])).toMatchObject({ status: "unmatched", reason: "no_match" });
    expect(matchIndbFood(item("roti roll", 1, "piece", null), [roti]).status).toBe("unmatched");
    expect(matchIndbFood(item("roti", 1, "roti", null), [{ ...roti, servingKcal: 2000 }]).status).toBe("unmatched");
    expect(matchIndbFood(item("poha", 1, "bowl", null), [{ ...poha, servingKcal: null }]).status).toBe("unmatched");
    const unsafeServing = matchIndbFood(item("poha", null, null, null), [{ ...poha, servingKcal: 2000 }]);
    expect(unsafeServing).toMatchObject({ status: "unmatched", reason: "portion_missing" });
    expect(unsafeServing.uncertainty).not.toContain("1 bowl");
    expect(matchIndbFood(item("roti", null, null, .001), [roti]).status).toBe("unmatched");
  });

  it("preserves item uncertainty and marks every candidate as a reference recipe", () => {
    const result = matchIndbFood({ ...item("Roti", 2, "roti", null), uncertainty: "AI assumed count" }, [roti]);
    expect(result.status).toBe("candidate");
    if (result.status === "candidate") {
      expect(result.uncertainty).toContain("AI assumed count");
      expect(result.uncertainty).toContain("reference recipe");
    }
  });
});

describe("opt-in catalog file", () => {
  const before = process.env.INDB_DATA_FILE;
  let folder: string | undefined;
  afterEach(async () => {
    if (before === undefined) delete process.env.INDB_DATA_FILE;
    else process.env.INDB_DATA_FILE = before;
    if (folder) await rm(folder, { recursive: true });
    folder = undefined;
  });

  it("fails closed when unset, absent, invalid or incomplete", async () => {
    delete process.env.INDB_DATA_FILE;
    expect((await lookupIndbFood(item("roti", 1, "roti", null))).status).toBe("unmatched");
    process.env.INDB_DATA_FILE = "/not/a/catalog.json";
    expect((await lookupIndbFood(item("roti", 1, "roti", null))).status).toBe("unmatched");
    folder = await mkdtemp(join(tmpdir(), "mealio-indb-test-"));
    process.env.INDB_DATA_FILE = join(folder, "catalog.json");
    await writeFile(process.env.INDB_DATA_FILE, JSON.stringify([{ ...roti, servingKcal: null }]));
    expect((await lookupIndbFood(item("roti", 1, "roti", null))).status).toBe("unmatched");
  });

  it("uses a private catalog, without exposing the file path in misses", async () => {
    folder = await mkdtemp(join(tmpdir(), "mealio-indb-test-"));
    process.env.INDB_DATA_FILE = join(folder, "catalog.json");
    await writeFile(process.env.INDB_DATA_FILE, JSON.stringify([roti, poha]));
    expect((await lookupIndbFood(item("roti", 2, "rotis", null))).status).toBe("candidate");
    const missing = await lookupIndbFood(item("unknown dish", null, null, null));
    expect(missing.status).toBe("unmatched");
    expect(JSON.stringify(missing)).not.toContain(folder);
  });
});

describe("opt-in private database catalog", () => {
  const previousSource = process.env.INDB_CATALOG_SOURCE;
  const previousFile = process.env.INDB_DATA_FILE;
  const query = vi.fn();
  beforeEach(() => {
    process.env.INDB_CATALOG_SOURCE = "database";
    process.env.INDB_DATA_FILE = "/private/missing.json";
    resetIndbDatabaseCacheForTests();
    query.mockReset();
    vi.mocked(getDb).mockReset().mockImplementation(() => ({
      select: () => ({ from: () => ({ where: () => ({ limit: query }) }) }),
    }) as unknown as ReturnType<typeof getDb>);
  });
  afterEach(() => {
    if (previousSource === undefined) delete process.env.INDB_CATALOG_SOURCE;
    else process.env.INDB_CATALOG_SOURCE = previousSource;
    if (previousFile === undefined) delete process.env.INDB_DATA_FILE;
    else process.env.INDB_DATA_FILE = previousFile;
    resetIndbDatabaseCacheForTests();
  });

  it("loads validated synthetic records and shares one database read across estimates", async () => {
    query.mockResolvedValue([{ records: [roti, poha] }]);
    const [first, second] = await Promise.all([
      lookupIndbFood(item("roti", 2, null, null)), lookupIndbFood(item("poha", 1, "bowl", null)),
    ]);
    expect(first).toMatchObject({ status: "candidate", sourceId: "TEST001" });
    expect(second).toMatchObject({ status: "candidate", sourceId: "TEST002" });
    expect((await lookupIndbFood(item("roti", 1, null, null))).status).toBe("candidate");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("fails closed without a row, with invalid catalog, or with a database error", async () => {
    for (const answer of [[], [{ records: [roti, { ...roti, sourceId: "TEST001" }] }]]) {
      resetIndbDatabaseCacheForTests();
      query.mockResolvedValueOnce(answer);
      expect(await lookupIndbFood(item("roti", 1, null, null))).toMatchObject({ status: "unmatched", reason: "no_match" });
    }
    resetIndbDatabaseCacheForTests();
    query.mockRejectedValueOnce(new Error("private database connection details"));
    const result = await lookupIndbFood(item("roti", 1, null, null));
    expect(result).toMatchObject({ status: "unmatched", reason: "no_match" });
    expect(JSON.stringify(result)).not.toContain("private database connection details");
  });

  it("exports the same strict validator for the one-time import", () => {
    expect(parseIndbCatalog([roti])).toEqual([roti]);
    expect(parseIndbCatalog([])).toBeNull();
    expect(parseIndbCatalog([roti, roti])).toBeNull();
  });
});
