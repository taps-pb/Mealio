import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { InterpretedItem } from "./interpret";
import { lookupIndbFood, matchIndbFood, type IndbRecord } from "./indb";

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
    expect(matchIndbFood(item("poha", 1, "bowl", null), [poha])).toMatchObject({
      status: "candidate", nutrients: { kcal: 180, protein: 6, carbs: 30 },
    });
    expect(matchIndbFood(item("idlis", 2, "idlis", null), [idli])).toMatchObject({
      status: "candidate", nutrients: { kcal: 140, protein: 6, carbs: 25 },
    });
    expect(matchIndbFood(item("idli", 2, "each", null), [idli]).status).toBe("candidate");
  });

  it("rejects ambiguous, unknown, mismatched, and implausible portions", () => {
    expect(matchIndbFood(item("roti", 1, "plate", null), [roti]).status).toBe("unmatched");
    expect(matchIndbFood(item("poha", 1, "piece", null), [poha]).status).toBe("unmatched");
    expect(matchIndbFood(item("roti", 1, null, null), [roti]).status).toBe("unmatched");
    expect(matchIndbFood(item("roti", 1, "roti", null), [roti, { ...roti, sourceId: "TEST004" }]).status).toBe("unmatched");
    expect(matchIndbFood(item("roti roll", 1, "piece", null), [roti]).status).toBe("unmatched");
    expect(matchIndbFood(item("roti", 1, "roti", null), [{ ...roti, servingKcal: 2000 }]).status).toBe("unmatched");
    expect(matchIndbFood(item("poha", 1, "bowl", null), [{ ...poha, servingKcal: null }]).status).toBe("unmatched");
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
