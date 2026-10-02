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
  it("formats the total, meal callout and accessible chart labels", () => {
    const html = renderToStaticMarkup(createElement(MealRing, { meals: [
      { id: "one", name: "Rice", kcal: 1850.57 },
      { id: "two", name: "Tea", kcal: 149.1 },
    ] }));
    expect(html).toContain("1,999.7 kcal total");
    expect(html).toContain("Show Rice, 1,850.6 calories");
    expect(html).toContain("1,850.6 kcal");
    expect(html).not.toContain("1850.5700000000");
  });
  it("keeps five-digit formatted totals in the responsive center and ignores invalid arc values", () => {
    const html = renderToStaticMarkup(createElement(MealRing, { meals: [
      { id: "large", name: "Large", kcal: 10_000.02 },
      { id: "bad", name: "Invalid", kcal: NaN },
    ] }));
    expect(html).toContain("10,000 kcal total");
    expect(html).toContain("--calorie-width:");
    expect(html).not.toContain("NaN");
  });
});
