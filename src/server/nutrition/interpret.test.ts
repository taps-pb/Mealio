import { describe, expect, it, vi } from "vitest";
import { interpretMeal, INTERPRETER_MODEL } from "./interpret";

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
});
