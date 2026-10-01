import { describe, expect, it, vi } from "vitest";
import { combineDishModifiers, interpretMeal, INTERPRETER_MODEL, retainSizeModifiers } from "./interpret";

const envelope = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const apiKey = ["unit", "test", "placeholder"].join("-");

describe("Fireworks meal interpretation", () => {
  it("itemizes foods without accepting model-generated nutrients", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope(JSON.stringify({ items: [
      { name: "eggs", quantity: 2, unit: "each", grams: 100, uncertainty: null, kcal: 150 },
    ] })));
    const result = await interpretMeal("two eggs", { apiKey, fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items[0].uncertainty).toContain("Estimated portion");
      expect(result.items[0]).not.toHaveProperty("kcal");
    }
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).model).toBe(INTERPRETER_MODEL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${apiKey}`);
  });

  it("rejects invalid nutrients/shape and does not leak provider errors", async () => {
    const bad = vi.fn().mockResolvedValue(envelope(JSON.stringify({ items: [{ name: "bread", kcal: 50 }] })));
    expect(await interpretMeal("bread", { apiKey, fetchImpl: bad })).toEqual({ ok: false, reason: "invalid_response" });
    const failure = vi.fn().mockRejectedValue(new Error("private provider details"));
    expect(JSON.stringify(await interpretMeal("bread", { apiKey, fetchImpl: failure }))).not.toContain("private provider details");
  });

  it("requires input and a server-only key", async () => {
    expect(await interpretMeal("", { apiKey })).toEqual({ ok: false, reason: "invalid_input" });
    expect(await interpretMeal("x".repeat(501), { apiKey })).toEqual({ ok: false, reason: "invalid_input" });
    expect(await interpretMeal("eggs", { apiKey: "" })).toEqual({ ok: false, reason: "unavailable" });
  });
  it("keeps sandwich toppings, pasta cheese, and cooking oil in their dish without merging separate sides", () => {
    const item = (name: string, quantity: number | null = null) => ({ name, quantity, unit: null, grams: null, uncertainty: null });
    expect(combineDishModifiers("2 homemade aloo paratha with little oil", [item("aloo paratha", 2), item("oil")]))
      .toMatchObject([{ name: "aloo paratha with little oil", quantity: 2 }]);
    expect(combineDishModifiers("30cm paneer tikka subway with lettuce onion and 3 sauces",
      [item("paneer tikka sub", 1), item("lettuce"), item("onion"), item("sauce 1", 1), item("sauce 2", 1), item("sauce 3", 1)]))
      .toMatchObject([{ name: "paneer tikka sub with lettuce onion and 3 sauces" }]);
    expect(combineDishModifiers("30cm paneer tikka subway with lettuce onion and 3 sauces",
      [item("paneer tikka sub", 1), item("lettuce"), item("onion"), item("sauces", 3)]))
      .toMatchObject([{ name: "paneer tikka sub with lettuce onion and 3 sauces" }]);
    expect(combineDishModifiers("one plate homemade pasta with cheese", [item("homemade pasta", 1), item("cheese")]))
      .toMatchObject([{ name: "homemade pasta with cheese" }]);
    expect(combineDishModifiers("2 roti with dal", [item("roti", 2), item("dal")])).toHaveLength(2);
    expect(combineDishModifiers("sandwich with fries", [item("sandwich"), item("fries")])).toHaveLength(2);
    expect(combineDishModifiers("30cm paneer sub with lettuce and 3 sauces", [item("paneer sub")]))
      .toMatchObject([{ name: "paneer sub with lettuce and 3 sauces" }]);
  });
  it("keeps the stated small side size when the model drops its adjective", () => {
    const items = [{ name: "roti", quantity: 2, unit: "piece", grams: null, uncertainty: null },
      { name: "sabzi", quantity: 1, unit: null, grams: null, uncertainty: null }];
    expect(retainSizeModifiers("2 roti with little sabzi", items)[1].name).toBe("little sabzi");
    expect(retainSizeModifiers("2 roti with sabzi", items)[1].name).toBe("sabzi");
  });
});
