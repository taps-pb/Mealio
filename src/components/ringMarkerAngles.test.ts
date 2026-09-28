import { describe, expect, it } from "vitest";

import { spreadRingMarkerAngles } from "./ringMarkerAngles";

const FULL_TURN = Math.PI * 2;
const radius = 67;

function assertSeparated(desired: number[], orbit = radius) {
  const result = spreadRingMarkerAngles(desired, orbit);
  expect(result).toHaveLength(desired.length);
  expect(result.every(Number.isFinite)).toBe(true);
  const minimum = Math.min(48, 2 * orbit * Math.sin(Math.PI / result.length));
  result.forEach((angle, index) => {
    const next = result[(index + 1) % result.length] + (index === result.length - 1 ? FULL_TURN : 0);
    expect(next - angle).toBeGreaterThan(0);
    expect(2 * orbit * Math.sin((next - angle) / 2)).toBeGreaterThanOrEqual(minimum - 1e-6);
  });
  return result;
}

describe("meal ring marker spacing", () => {
  it("leaves empty, single, and already well-spaced markers alone", () => {
    expect(spreadRingMarkerAngles([], radius)).toEqual([]);
    expect(spreadRingMarkerAngles([1], radius)).toEqual([1]);
    expect(spreadRingMarkerAngles([0, Math.PI], radius)).toEqual([0, Math.PI]);
    expect(spreadRingMarkerAngles([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2], radius))
      .toEqual([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]);
    expect(spreadRingMarkerAngles([0, .1, .2], 0)).toEqual([0, .1, .2]);
  });

  it("separates two close meals and two tiny meals after large meals", () => {
    assertSeparated([.1, .12]);
    const calories = [200, 90, 2, 1];
    let start = 0;
    const desired = calories.map((kcal) => {
      const angle = (start + kcal / 2) / 293 * FULL_TURN;
      start += kcal;
      return angle;
    });
    const result = assertSeparated(desired);
    expect(result[2]).not.toBe(desired[2]);
    expect(result[3]).not.toBe(desired[3]);
    expect(desired).toHaveLength(4);
  });

  it("separates markers across the seam and fully overlapping markers", () => {
    assertSeparated([.02, 1, 3, FULL_TURN - .02]);
    for (let count = 2; count <= 8; count++) assertSeparated(Array(count).fill(1));
  });

  it("caps spacing when more targets than can fit, without reversing order", () => {
    assertSeparated(Array.from({ length: 40 }, (_, index) => index / 40 * FULL_TURN));
    assertSeparated(Array(40).fill(.1));
  });

  it("does not mutate desired positions", () => {
    const desired = [0, .02, 1, 2];
    const copy = [...desired];
    spreadRingMarkerAngles(desired, radius);
    expect(desired).toEqual(copy);
  });
});
