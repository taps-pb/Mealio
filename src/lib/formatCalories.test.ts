import { describe, expect, it } from "vitest";
import { formatCalories } from "./formatCalories";

describe("formatCalories", () => {
  it.each([
    ["1850.5700000000", "1,850.6"],
    ["149.100000", "149.1"],
    ["500.000000", "500"],
    [0, "0"],
    ["123.456789", "123.5"],
    [10_000, "10,000"],
    [1_234_567.89, "12,34,567.9"],
    [null, "0"],
    [undefined, "0"],
    ["not a number", "0"],
    ["12abc", "0"],
    ["", "0"],
    ["   ", "0"],
    ["1,850", "0"],
    [NaN, "0"],
    [Infinity, "0"],
    [-Infinity, "0"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatCalories(input)).toBe(expected);
  });

  it("formats floating-point sums without altering the underlying amount", () => {
    const total = [612.4, 738.17, 500].reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1850.57);
    expect(formatCalories(total)).toBe("1,850.6");
    expect(total).toBeCloseTo(1850.57);
  });
});
