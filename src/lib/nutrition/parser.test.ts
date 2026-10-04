import { describe, expect, it } from "vitest";
import { parseItem, parseMeal } from "./parser";
import { normalize } from "./normalize";
import { realFoodCorpus } from "./corpus";

describe("offline natural meal parser", () => {
  const counts = [1, 3, 6, 2, 1, 1, 1, 1, 5, 1, 1, 1, 2, 1, 2, 1, 4, 3, 2, 1, 1, 1, 1, 2, 2];
  it.each(realFoodCorpus.map((text, i) => [text, counts[i]] as const))("splits the real input: %s", (text, count) => {
    const parsed = parseMeal(text);
    expect(parsed).toHaveLength(count);
    expect(parsed.every((item) => !item.error && text.includes(item.rawText))).toBe(true);
  });
  it.each([
    ["half small bowl sambar", .5, "bowl", "small", "sambar"],
    ["one big spoon boiled corn", 1, "spoon", "large", "boiled corn"],
    ["5 mediums size idli", 5, null, "medium", "idli"],
    ["1 half plate vegetable biryani", .5, "plate", null, "vegetable biryani"],
    ["26.5 gram green uncle chips", 26.5, "g", null, "green uncle chips"],
    ["100g apple", 100, "g", null, "apple"], ["200ml milk", 200, "ml", null, "milk"],
    ["half a bowl kheer", .5, "bowl", null, "kheer"], ["quarter glass lassi", .25, "glass", null, "lassi"],
    ["Cornitos small bag", 1, "bag", "small", "cornitos"], ["180 ml Fanta can", 180, "ml", null, "fanta"],
  ])("parses quantity/size/unit: %s", (text, quantity, unit, size, food) => {
    expect(parseItem(String(text))).toMatchObject({ quantity, unit, size, food });
  });
  it("protects longest compound phrases and preserves the original text", () => {
    expect(parseMeal("1 plate rajma and chawal + 2 roti").map((i) => i.food)).toEqual(["rajma and chawal", "roti"]);
    expect(parseMeal("1 bowl rajma + 200 g rice")).toHaveLength(2);
    const raw = "2 Aalu Pyaz Parantha";
    expect(parseItem(raw)).toMatchObject({ rawText: raw, food: "aloo pyaaz paratha" });
    expect(normalize("ｋｈｅｒ")).toBe("kheer");
  });
  it("keeps restaurant length separate from quantity and mass", () => {
    expect(parseItem("30cm paneer tikka subway sandwich")).toMatchObject({ quantity: 1, unit: null, variant: "30 cm", food: "paneer tikka subway sandwich" });
    expect(parseItem("2 15cm paneer tikka subway")).toMatchObject({ quantity: 2, variant: "15 cm" });
  });
  it("recognizes price ambiguity and rejects malformed quantities", () => {
    expect(parseItem("Dairy milk 26 rupees").price).toBe(true);
    expect(parseItem("Dairy Milk ₹26").price).toBe(true);
    for (const input of ["0 g apple", "10001 bowls rice"]) expect(parseItem(input).error).toBeDefined();
    for (const input of ["", "apple +", "a".repeat(501), Array(21).fill("apple").join(",")]) expect(() => parseMeal(input)).toThrow();
  });
});
