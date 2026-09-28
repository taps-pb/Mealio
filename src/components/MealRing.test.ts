import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MealRing from "./MealRing";

describe("meal share colors", () => {
  it("uses four distinct arc colors and avoids repeating the first at the seam", () => {
    const meals = Array.from({ length: 5 }, (_, index) => ({
      id: `meal-${index}`, name: `Meal ${index + 1}`, kcal: 100,
    }));
    const html = renderToStaticMarkup(createElement(MealRing, { meals }));
    const arcs = [...html.matchAll(/<circle[^>]*stroke="(var\(--color-arc-[^)]+\))"/g)]
      .map((match) => match[1]);
    const dots = [...html.matchAll(/<button[^>]*style="[^"]*background:(var\(--color-arc-[^)]+\))/g)]
      .map((match) => match[1]);

    expect(arcs).toEqual([
      "var(--color-arc-primary)",
      "var(--color-arc-secondary)",
      "var(--color-arc-tertiary)",
      "var(--color-arc-quaternary)",
      "var(--color-arc-secondary)",
    ]);
    expect(dots).toEqual(arcs);
  });
});
