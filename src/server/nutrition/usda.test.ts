import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupUsdaFood } from "./usda";

const item = { name: "chicken breast", quantity: 1, unit: "portion", grams: 150, uncertainty: "Estimated weight" };
const testApiKey = ["test", "placeholder"].join("-");
const food = { fdcId: 123, description: "Chicken breast", foodNutrients: [
  { nutrientId: 1008, value: 165 }, { nutrientId: 1003, value: 31 }, { nutrientId: 1005, value: 0 },
] };
const egg = { fdcId: 171287, description: "Egg, whole, raw, fresh", foodNutrients: [
  { nutrientId: 1008, value: 143 }, { nutrientId: 1003, value: 12.6 }, { nutrientId: 1005, value: .72 },
] };
const mango = { fdcId: 169910, description: "Mangos, raw", foodNutrients: [
  { nutrientId: 1008, value: 60 }, { nutrientId: 1003, value: .82 }, { nutrientId: 1005, value: 15 },
] };
const response = (foods: unknown[]) => new Response(JSON.stringify({ foods }), { status: 200 });

describe("USDA review candidates", () => {
  it.each([
    ["apple", "Apples, raw, with skin", "medium", 182],
    ["banana", "Bananas, raw", "medium", 118],
    ["egg", "Egg, whole, raw, fresh", "large", 50],
    ["orange", "Oranges, raw, all commercial varieties", "medium", 131],
    ["milk", "Milk, whole, 3.25% milkfat", "cup", 244],
    ["cooked rice", "Rice, white, long-grain, regular, enriched, cooked", "cup", 158],
  ])("resolves %s using the selected USDA food's actual portion", async (name, description, portion, weight) => {
    const common = { fdcId: 999, description, foodNutrients: [
      { nutrientId: 1008, value: 100 }, { nutrientId: 1003, value: 2 },
      { nutrientId: 1005, value: 10 }, { nutrientId: 1004, value: 3 },
    ] };
    const fetchImpl = vi.fn().mockResolvedValueOnce(response([common, { ...common, fdcId: 998, description: `${name} pie` }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ description, foodPortions: [{ amount: 1, modifier: portion, gramWeight: weight }] })));
    const result = await lookupUsdaFood({ name, quantity: 1, unit: name === "milk" ? "glass" : name === "cooked rice" ? "cup" : null,
      grams: null, uncertainty: null }, { apiKey: testApiKey, fetchImpl });
    expect(result).toMatchObject({ status: "candidate", sourceId: "999", grams: weight,
      nutrients: { kcal: weight, fat: Math.round(3 * weight) / 100 } });
    if (result.status === "candidate") expect(result.portionUncertainty).toContain(`USDA ${portion} portion`);
  });

  it("uses measured grams without assuming a portion, and rejects wrong cooking states", async () => {
    const cooked = { ...food, description: "Rice, white, long-grain, regular, enriched, cooked" };
    const fetchImpl = vi.fn().mockImplementation(async () => response([cooked, { ...cooked, fdcId: 124, description: "Rice, white, raw" }]));
    const found = await lookupUsdaFood({ name: "cooked rice", quantity: null, unit: null, grams: 200, uncertainty: null },
      { apiKey: testApiKey, fetchImpl });
    expect(found).toMatchObject({ status: "candidate", grams: 200, nutrients: { kcal: 330 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await lookupUsdaFood({ name: "fried rice", quantity: 1, unit: null, grams: 200, uncertainty: null },
      { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
  });

  it("scales per-100g nutrients and retains portion uncertainty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([food]));
    const result = await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl });
    expect(result).toMatchObject({ status: "candidate", sourceId: "123", description: "Chicken breast", grams: 150,
      nutrients: { kcal: 247.5, protein: 46.5, carbs: 0, fat: null }, uncertainty: "Estimated weight" });
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string).query).toBe("chicken breast");
  });

  it("rejects unrelated hits and missing nutrients, but estimates unknown weight with a warning", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([{ ...food, description: "Chicken thigh" }]));
    expect((await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
    fetchImpl.mockResolvedValue(response([{ ...food, foodNutrients: food.foodNutrients.slice(0, 2) }]));
    expect((await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
    fetchImpl.mockResolvedValueOnce(response([food])).mockResolvedValueOnce(new Response(JSON.stringify({ description: food.description, foodPortions: [] })));
    const estimated = await lookupUsdaFood({ ...item, grams: null }, { apiKey: testApiKey, fetchImpl });
    expect(estimated.status).toBe("candidate");
    if (estimated.status === "candidate") expect(estimated.portionUncertainty).toContain("no source-backed portion");
  });

  it("returns generic unavailable failures without leaking a key", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("secret provider detail"));
    const result = await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl });
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain(testApiKey);
  });

  it("uses USDA's large whole-egg portion as a labeled assumption for one egg", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response([egg]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ description: egg.description, foodPortions: [
        { amount: 1, gramWeight: 243, modifier: "cup (4.86 large eggs)" },
        { amount: 1, gramWeight: 50, modifier: "large" },
      ] })));
    const result = await lookupUsdaFood({ name: "egg", quantity: 1, unit: null, grams: null, uncertainty: null }, { apiKey: testApiKey, fetchImpl });
    expect(result.status).toBe("candidate");
    if (result.status === "candidate") {
      expect(result.grams).toBe(50);
      expect(result.nutrients).toMatchObject({ kcal: 71.5, protein: 6.3, carbs: .36, fat: null });
      expect(result.uncertainty).toContain("Estimated 1 × 50 g USDA large portion");
      expect(result.uncertainty).toContain("confirm size");
    }
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string).query).toBe("Egg, whole, raw, fresh");
    expect(fetchImpl.mock.calls[1][0]).toContain("/food/171287");
  });

  it("does not serve raw onion as branded onion rings, tomato as soup or water as a plant", async () => {
    for (const [name, bad] of [["onion", "DENNY'S, onion rings"], ["tomato", "CAMPBELL'S, Tomato Soup, condensed"],
      ["water", "Water convolvulus, raw"]]) {
      const fetchImpl = vi.fn(async () => response([{ ...food, description: bad }]));
      const result = await lookupUsdaFood({ name, quantity: null, unit: "g", grams: 100, uncertainty: null }, { apiKey: testApiKey, fetchImpl });
      expect(result.status).toBe("unmatched");
    }
  });
  it("never mistakes potato bread or sweet potato for an ordinary potato", async () => {
    const plain = { name: "potato", quantity: null, unit: "g", grams: 100, uncertainty: null };
    const potatoes = { ...food, description: "Potatoes, flesh and skin, raw" };
    const wrong = [{ ...food, fdcId: 124, description: "Bread, potato" }, { ...food, fdcId: 125, description: "Sweet potato, raw" }];
    const found = await lookupUsdaFood(plain, { apiKey: testApiKey, fetchImpl: vi.fn(async () => response([...wrong, potatoes])) });
    expect(found).toMatchObject({ status: "candidate", sourceId: "123" });
    const failed = await lookupUsdaFood(plain, { apiKey: testApiKey, fetchImpl: vi.fn(async () => response(wrong)) });
    expect(failed.status).toBe("unmatched");
    const boiled = await lookupUsdaFood({ ...plain, name: "boiled potato" }, { apiKey: testApiKey, fetchImpl: vi.fn(async () =>
      response([{ ...food, description: "Sweet potato, cooked, boiled, without skin" },
        { ...food, description: "Potatoes, boiled, cooked without skin, flesh, without salt", fdcId: 126 }])) });
    expect(boiled).toMatchObject({ status: "candidate", sourceId: "126" });
  });
  it("rejects impossible per-100g nutrients instead of selecting the first lexical match", async () => {
    const invalid = { ...food, description: "Potatoes, flesh and skin, raw", foodNutrients: [
      { nutrientId: 1008, value: 1800 }, { nutrientId: 1003, value: 1 },
      { nutrientId: 1005, value: 17 }, { nutrientId: 1004, value: 150 },
    ] };
    const result = await lookupUsdaFood({ name: "potato", quantity: null, unit: "g", grams: 100, uncertainty: null },
      { apiKey: testApiKey, fetchImpl: vi.fn(async () => response([invalid])) });
    expect(result.status).toBe("unmatched");
  });
  it("rejects food-name coincidences for poha, ice, dairy, and blended olive oil", async () => {
    const itemFor = (name: string) => ({ name, grams: 100, quantity: null, unit: "g", uncertainty: null });
    const search = (foods: unknown[]) => vi.fn(async () => response(foods));
    for (const [name, wrong] of [
      ["poha", "Groundcherries, (cape-gooseberries or poha), raw"],
      ["ice", "Ice cream sandwich"],
      ["whole milk", "Cheese, mozzarella, whole milk"],
      ["plain yogurt", "SILK Plain soy yogurt"],
      ["yogurt", "Tofu yogurt"],
      ["olive oil", "Oil, corn, peanut, and olive"],
    ]) {
      const result = await lookupUsdaFood(itemFor(name), { apiKey: testApiKey,
        fetchImpl: search([{ ...food, description: wrong }]) });
      expect(result.status, `${name} must not select ${wrong}`).toBe("unmatched");
    }
    const milk = await lookupUsdaFood(itemFor("whole milk"), { apiKey: testApiKey, fetchImpl: search([
      { ...food, description: "Cheese, mozzarella, whole milk" },
      { ...food, fdcId: 200, description: "Milk, whole, 3.25% milkfat" },
    ]) });
    expect(milk).toMatchObject({ status: "candidate", sourceId: "200" });
    const yogurt = await lookupUsdaFood(itemFor("plain yogurt"), { apiKey: testApiKey, fetchImpl: search([
      { ...food, description: "SILK Plain soy yogurt" },
      { ...food, fdcId: 201, description: "Yogurt, plain, whole milk" },
    ]) });
    expect(yogurt).toMatchObject({ status: "candidate", sourceId: "201" });
  });
  it("does not assume 100 g of unquantified cooking oil or cheese topping", async () => {
    for (const name of ["oil", "ghee", "cheese"]) {
      const result = await lookupUsdaFood({ name, quantity: null, unit: null, grams: null, uncertainty: null },
        { apiKey: testApiKey, fetchImpl: vi.fn(async () => response([food])) });
      expect(result.status).toBe("unmatched");
    }
  });
  it("uses a labeled small-handful weight instead of defaulting almonds to 100 g", async () => {
    const request = vi.fn(async () => response([{ ...food, description: "Nuts, almonds" }]));
    const result = await lookupUsdaFood({ name: "almonds", quantity: 1, unit: "small handful", grams: null, uncertainty: null },
      { apiKey: testApiKey, fetchImpl: request });
    expect(result).toMatchObject({ status: "candidate", grams: 15, matchConfidence: "low" });
    if (result.status === "candidate") expect(result.portionUncertainty).toContain("no source-backed portion");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("maps green bell pepper only to a raw sweet green pepper, not a hot pepper", async () => {
    const item = { name: "green bell pepper", quantity: null, unit: "g", grams: 60, uncertainty: null };
    const sweet = { ...food, description: "Peppers, sweet, green, raw" };
    const hot = { ...food, fdcId: 124, description: "Peppers, hot chili, green, raw" };
    const found = await lookupUsdaFood(item, { apiKey: testApiKey, fetchImpl: vi.fn(async () => response([hot, sweet])) });
    expect(found).toMatchObject({ status: "candidate", sourceId: "123" });
    if (found.status === "candidate") expect(found.assumptions.join(" ")).toContain("sweet green pepper");
  });

  it("scales an edible whole-mango portion and preserves USDA provenance", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response([mango]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ description: mango.description, foodPortions: [
        { amount: 1, gramWeight: 336, modifier: "fruit without refuse" },
      ] })));
    const result = await lookupUsdaFood({ name: "mango", quantity: 1, unit: null, grams: null, uncertainty: null }, { apiKey: testApiKey, fetchImpl });
    expect(result.status).toBe("candidate");
    if (result.status === "candidate") {
      expect(result.sourceId).toBe("169910");
      expect(result.grams).toBe(336);
      expect(result.nutrients).toMatchObject({ kcal: 201.6, protein: 2.76, carbs: 50.4 });
      expect(result.uncertainty).toContain("Estimated 1 × 336 g USDA fruit without refuse portion");
    }
  });

  it("never substitutes egg white; missing portions remain explicitly uncertain", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response([{ ...egg, description: "Egg white, raw" }]))
      .mockResolvedValueOnce(response([egg]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ description: egg.description, foodPortions: [] })))
      .mockResolvedValueOnce(response([]));
    const count = { name: "egg", quantity: 1, unit: "each", grams: null, uncertainty: null };
    expect((await lookupUsdaFood(count, { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
    const estimated = await lookupUsdaFood(count, { apiKey: testApiKey, fetchImpl });
    expect(estimated.status).toBe("candidate");
    if (estimated.status === "candidate") expect(estimated.portionUncertainty).toContain("Confirm the weight");
    expect((await lookupUsdaFood({ ...count, name: "unknown fruit" }, { apiKey: testApiKey, fetchImpl })).status).toBe("unmatched");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe("private USDA key loading", () => {
  let directory: string;
  let keyFile: string;
  let previousKey: string | undefined;
  let previousFile: string | undefined;
  const fetchImpl = vi.fn().mockImplementation(async () => response([]));

  beforeEach(async () => {
    previousKey = process.env.USDA_API_KEY;
    previousFile = process.env.USDA_KEY_FILE;
    delete process.env.USDA_API_KEY;
    directory = await mkdtemp(join(tmpdir(), "mealio-usda-test-"));
    keyFile = join(directory, "usda_api.txt");
    process.env.USDA_KEY_FILE = keyFile;
    fetchImpl.mockClear();
  });

  afterEach(async () => {
    if (previousKey === undefined) delete process.env.USDA_API_KEY;
    else process.env.USDA_API_KEY = previousKey;
    if (previousFile === undefined) delete process.env.USDA_KEY_FILE;
    else process.env.USDA_KEY_FILE = previousFile;
    await rm(directory, { recursive: true });
  });

  it("reads a raw key at lookup time and never returns it", async () => {
    await writeFile(keyFile, "raw-test-key\n");
    const result = await lookupUsdaFood(item, { fetchImpl });
    expect(result.status).toBe("unmatched");
    expect(fetchImpl.mock.calls[0][0]).toContain("raw-test-key");
    expect(JSON.stringify(result)).not.toContain("raw-test-key");
  });

  it("accepts a quoted USDA_API_KEY assignment", async () => {
    await writeFile(keyFile, `${["USDA_API", "KEY"].join("_")}="file-test-key"\n`);
    expect((await lookupUsdaFood(item, { fetchImpl })).status).toBe("unmatched");
    expect(fetchImpl.mock.calls[0][0]).toContain("file-test-key");
  });

  it("uses the deployment environment first, and respects an explicit empty override", async () => {
    await writeFile(keyFile, "file-test-key\n");
    process.env.USDA_API_KEY = ["env", "test", "key"].join("-");
    expect((await lookupUsdaFood(item, { fetchImpl })).status).toBe("unmatched");
    expect(fetchImpl.mock.calls[0][0]).toContain("env-test-key");
    expect((await lookupUsdaFood(item, { fetchImpl, apiKey: "" })).status).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing, blank or malformed files without leaking details", async () => {
    expect((await lookupUsdaFood(item, { fetchImpl })).status).toBe("unavailable");
    for (const contents of [" \n", "one\ntwo\n", "OTHER_KEY=wrong\n"]) {
      await writeFile(keyFile, contents);
      const result = await lookupUsdaFood(item, { fetchImpl });
      expect(result.status).toBe("unavailable");
      expect(JSON.stringify(result)).not.toContain(keyFile);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when a portion weight is unknown and credentials are unavailable", async () => {
    const result = await lookupUsdaFood({ ...item, grams: null }, { fetchImpl });
    expect(result.status).toBe("unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
