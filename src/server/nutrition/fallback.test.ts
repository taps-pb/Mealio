import { describe, expect, it, vi } from "vitest";
import { approximatePortion, commonApproximation, estimateMissingIngredients, estimateWholeDish } from "./fallback";

const mockFetch = (content: unknown) => vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => {
  void _input; void _init;
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
});

describe("bounded estimate fallback", () => {
  it("uses cautious generic ingredient compositions, never a food-name substring", () => {
    expect(commonApproximation("paneer", 150)?.nutrients).toMatchObject({ kcal: 397.5, protein: 27, fat: 30 });
    expect(commonApproximation("ghee", 20)?.nutrients.kcal).toBe(180);
    expect(commonApproximation("almonds", 15)?.nutrients.kcal).toBeGreaterThan(80);
    expect(approximatePortion({ name: "almonds", quantity: 1, unit: "small handful", grams: null, uncertainty: null })?.grams).toBe(15);
    expect(commonApproximation("ghee or cooking oil for dough and pan-frying", 25)?.nutrients.fat).toBe(25);
    expect(commonApproximation("whole wheat flour (atta), raw", 120)?.nutrients.carbs).toBeGreaterThan(80);
    expect(commonApproximation("potato, boiled and mashed", 100)?.nutrients.kcal).toBe(87);
    expect(commonApproximation("water for dough", 50)?.nutrients.kcal).toBe(0);
    expect(commonApproximation("potato bread", 100)).toBeNull();
    expect(commonApproximation("unknown mystery sauce", 100)).toBeNull();
    expect(approximatePortion({ name: "boiled egg", quantity: 2, unit: null, grams: null, uncertainty: null })?.grams).toBe(100);
  });

  it("accepts only matching, physically plausible model ingredient estimates", async () => {
    const missing = [{ name: "carom seeds", grams: 2 }, { name: "mystery sauce", grams: 20 }];
    const fetchImpl = mockFetch({ ingredients: [
      { name: "carom seeds", grams: 2, kcal: 8, protein: .3, carbs: 1, fat: .38 },
      { name: "mystery sauce", grams: 20, kcal: 900, protein: 0, carbs: 0, fat: 100 },
    ] });
    const result = await estimateMissingIngredients("vegetable paratha", missing, { apiKey: "test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("carom seeds");
    expect(result[0].assumption).toContain("Model-estimated");
    const prompt = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(prompt.messages[0].content).toContain("4*protein");
    const wrongName = mockFetch({ ingredients: [{ name: "potato bread", grams: 2, kcal: 8, protein: .3, carbs: 1, fat: .38 }] });
    expect(await estimateMissingIngredients("paratha", missing, { apiKey: "test", fetchImpl: wrongName as unknown as typeof fetch })).toEqual([]);
  });

  it("accepts a coherent whole-dish estimate and rejects invented impossible macros", async () => {
    const item = { name: "aloo pyaaz paratha", quantity: 2, unit: "piece", grams: null, uncertainty: null };
    const value = { name: item.name, grams: 300, kcal: 760, protein: 19, carbs: 108, fat: 28,
      assumptions: ["Typical homemade filling and cooking oil"] };
    const estimate = await estimateWholeDish("2 aloo pyaaz paratha", item, { apiKey: "test", fetchImpl: mockFetch(value) as unknown as typeof fetch });
    expect(estimate?.nutrients.kcal).toBeGreaterThan(700);
    expect(estimate?.assumptions).toContain("Typical homemade filling and cooking oil");
    expect(await estimateWholeDish("2 aloo pyaaz paratha", item, { apiKey: "test",
      fetchImpl: mockFetch({ ...value, kcal: 9000 }) as unknown as typeof fetch })).toBeNull();
  });
});
