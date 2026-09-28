import { describe, expect, it } from "vitest";

import { ringColorIndices } from "./ringColors";

describe("closed meal ring colors", () => {
  it("keeps the first four meals distinct and avoids a fifth-first seam collision", () => {
    expect(ringColorIndices(0)).toEqual([]);
    expect(ringColorIndices(1)).toEqual([0]);
    expect(ringColorIndices(2)).toEqual([0, 1]);
    expect(ringColorIndices(3)).toEqual([0, 1, 2]);
    expect(ringColorIndices(4)).toEqual([0, 1, 2, 3]);
    expect(ringColorIndices(5)).toEqual([0, 1, 2, 3, 1]);
    expect(ringColorIndices(6)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(ringColorIndices(9)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 1]);
  });

  it("never gives touching arcs the same color, even where the ring closes", () => {
    for (let count = 2; count <= 100; count++) {
      const slots = ringColorIndices(count);
      expect(slots).toHaveLength(count);
      expect(new Set(slots.slice(0, Math.min(4, count))).size).toBe(Math.min(4, count));
      slots.forEach((slot, index) => {
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(4);
        expect(slot).not.toBe(slots[(index + 1) % count]);
      });
    }
  });
});
