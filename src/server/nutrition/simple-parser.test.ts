import { describe, expect, it } from "vitest";
import { parseSimpleMeal } from "./simple-parser";

describe("common-food parser", () => {
  it.each([["apple", "apple", 1, null], ["aplpe", "apple", 1, null], ["bananna", "banana", 1, null], ["2 eggs", "egg", 2, null],
    ["200g cooked rice", "cooked rice", null, 200], ["1 glass milk", "milk", 1, null],
    ["medium ornage", "orange", 1, null]] as const)("parses %s", (input, name, quantity, grams) => {
    expect(parseSimpleMeal(input)?.[0]).toMatchObject({ name, quantity, grams });
  });
  it("retains preparation and brand contexts by deferring them rather than stripping them", () => {
    for (const input of ["fried egg", "Subway paneer sandwich", "apple with sauce", "200g rice", "cooked rice with oil", "milkshake"]) {
      expect(parseSimpleMeal(input)).toBeNull();
    }
  });
  it("parses simple combinations and rejects malformed quantities", () => {
    expect(parseSimpleMeal("2 apples and 1 banana")).toHaveLength(2);
    expect(parseSimpleMeal("0 eggs")).toBeNull();
  });
});
