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
  it("returns gracefully on provider failure", async () => {
    const failed = vi.fn(async () => { throw new Error("private detail"); });
    expect((await interpretRecipe("biryani", { apiKey: "test", fetchImpl: failed })).ok).toBe(false);
  });
});
