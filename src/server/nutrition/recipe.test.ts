import { describe, expect, it, vi } from "vitest";
import { interpretRecipe } from "./recipe";

const fetchOf = (body: unknown) => vi.fn(async (..._args: Parameters<typeof fetch>) => {
  void _args;
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }));
});
describe("structured recipe interpretation", () => {
  it.each(["half plate vegetable biryani", "paneer butter masala", "chilli paneer"])("uses hypothetical ingredient weights for %s", async (name) => {
    const fetchImpl = fetchOf({ name, grams: 250, ingredients: [{ name: "cooked rice", grams: 200 }, { name: "oil", grams: 50 }],
      assumptions: ["Assumed standard restaurant preparation"] });
    const result = await interpretRecipe(name, { apiKey: "test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.ingredients).toHaveLength(2); expect(result.uncertainty).toContain("Hypothetical"); }
    const prompt = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(prompt.messages[0].content).toContain("Do NOT provide calories");
  });
  it("rejects malformed responses and implausible gram sums", async () => {
    expect((await interpretRecipe("biryani", { apiKey: "test", fetchImpl: fetchOf({ name: "x", grams: 250,
      ingredients: [{ name: "oil", grams: 2000 }], assumptions: ["test"] }) as unknown as typeof fetch })).ok).toBe(false);
    const invalid = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not JSON" } }] })));
    expect(await interpretRecipe("biryani", { apiKey: "test", fetchImpl: invalid })).toEqual({ ok: false, reason: "invalid_response" });
  });
  it("labels and reconciles a modest model ingredient-weight inconsistency", async () => {
    const data = { name: "vegetable biryani", grams: 250,
      ingredients: [{ name: "cooked rice", grams: 230 }, { name: "oil", grams: 62 }], assumptions: ["Oil quantity unknown"] };
    const result = await interpretRecipe("half plate vegetable biryani", { apiKey: "test", fetchImpl: fetchOf(data) as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ingredients.reduce((sum, item) => sum + item.grams, 0)).toBeCloseTo(250, 1);
      expect(result.assumptions.join(" ")).toContain("did not add up");
    }
  });
  it("does not scale flour or oil down when raw dough loses water during cooking", async () => {
    const value = { name: "stuffed pan-fried flatbread", grams: 300,
      ingredients: [{ name: "whole wheat flour, raw", grams: 100 }, { name: "cooked potato", grams: 130 },
        { name: "ghee", grams: 30 }, { name: "water for dough", grams: 90 }],
      assumptions: ["Dough loses moisture on the pan"] };
    const result = await interpretRecipe("2 stuffed flatbreads", { apiKey: "test", fetchImpl: fetchOf(value) as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ingredients.find((ingredient) => ingredient.name === "ghee")?.grams).toBe(30);
      expect(result.assumptions.join(" ")).toContain("moisture");
    }
  });
  it("does not inflate dry grains and oil to account for absorbed water in a cooked bowl", async () => {
    const value = { name: "cooked grain bowl", grams: 250, ingredients: [
      { name: "flattened rice, dry", grams: 60 }, { name: "vegetables", grams: 70 },
      { name: "vegetable oil", grams: 10 }, { name: "water", grams: 70 }],
    assumptions: ["Some water is absorbed"] };
    const result = await interpretRecipe("one medium bowl cooked grain", { apiKey: "test", fetchImpl: fetchOf(value) as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ingredients.find((entry) => entry.name === "vegetable oil")?.grams).toBe(10);
      expect(result.ingredients.find((entry) => entry.name === "flattened rice, dry")?.grams).toBe(60);
      expect(result.assumptions.join(" ")).toContain("water absorption");
    }
  });
  it("reconciles an oversized raw-and-water ingredient list instead of discarding a plausible serving", async () => {
    const value = { name: "stuffed pan-fried bread", grams: 320, ingredients: [
      { name: "whole wheat flour, dry", grams: 120 }, { name: "potato, raw", grams: 150 },
      { name: "ghee", grams: 30 }, { name: "water", grams: 100 }, { name: "onion", grams: 50 }],
    assumptions: ["Water evaporates on the pan"] };
    const result = await interpretRecipe("2 stuffed pan-fried breads", { apiKey: "test", fetchImpl: fetchOf(value) as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grams).toBe(320);
      expect(result.ingredients.reduce((sum, entry) => sum + entry.grams, 0)).toBeCloseTo(320, 0);
      expect(result.assumptions.join(" ")).toContain("scaling other ingredients");
      expect(result.ingredients.find((entry) => entry.name === "whole wheat flour, dry")?.grams).toBeGreaterThan(80);
    }
  });
  it("returns gracefully on provider failure", async () => {
    const failed = vi.fn(async () => { throw new Error("private detail"); });
    expect((await interpretRecipe("biryani", { apiKey: "test", fetchImpl: failed })).ok).toBe(false);
  });
});
