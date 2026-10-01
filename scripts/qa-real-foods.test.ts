/** Opt-in live API QA. Run only with RUN_LIVE_FOOD_QA=1; never uses the owner database. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const matched = vi.hoisted(() => [] as { query: string; description: string; sourceId: string }[]);
vi.mock("@/server/auth/request-origin", () => ({ acceptsSameOriginMutation: () => true }));
vi.mock("@/server/auth/session", () => ({ findSession: async () => ({ admin: { id: "isolated-qa" } }) }));
vi.mock("@/server/nutrition/personal", () => ({ getCachedResolution: async () => null,
  getPortionPreference: async () => null, putCachedResolution: async () => undefined }));
// Exclude private owner data: the live pass deliberately tests the public USDA/model paths.
vi.mock("@/server/nutrition/indb", () => ({ lookupIndbFood: async () =>
  ({ status: "unmatched", reason: "no_match", uncertainty: "Private catalog excluded from isolated QA." }) }));
vi.mock("@/server/nutrition/usda", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/nutrition/usda")>();
  return { ...actual, lookupUsdaFood: async (...args: Parameters<typeof actual.lookupUsdaFood>) => {
    const result = await actual.lookupUsdaFood(...args);
    if (result.status === "candidate") matched.push({ query: args[0].name, description: result.description, sourceId: result.sourceId });
    return result;
  } };
});

import { POST } from "../src/app/api/estimate/route";

const foods = [
  "2 homemade aloo paratha with little oil", "2 aloo pyaaz paratha", "one plate rajma chawal",
  "half plate veg biryani", "paneer tikka around 8 pieces", "2 roti with dal and little sabzi",
  "one bowl maggi", "30cm paneer tikka subway with lettuce onion and 3 sauces", "small handful almonds",
  "one big glass mango shake", "2 slices pizza", "2 boiled eggs", "1 banana", "one samosa",
  "chole bhature", "poha one medium bowl", "3 idli with sambar", "masala dosa",
  "dal makhani with 2 roti", "one plate homemade pasta with cheese",
] as const;
const selected = process.env.MEALIO_QA_INPUTS
  ? foods.filter((_, index) => process.env.MEALIO_QA_INPUTS?.split(",").map(Number).includes(index + 1))
  : [...foods];

type Item = { name: string; quantity: number | null; unit: string | null; grams: number | null;
  kcal: number | null; protein: number | null; carbs: number | null; fat?: number | null;
  source: string; matchConfidence?: string; ingredients?: { name: string; source: string; kcal: number | null }[] };
type Total = { kcal: number; protein: number; carbs: number; fat: number | null } | null;

const live = process.env.RUN_LIVE_FOOD_QA === "1" ? describe : describe.skip;
live("isolated live food-estimation QA", () => {
  it("records selected messy descriptions and checks broad plausibility", async () => {
    const raw = (await readFile(resolve(process.cwd(), "../.secrets/fw_api.txt"), "utf8")).trim();
    const key = raw.replace(/^FIREWORKS_API_KEY=/, "").trim();
    if (!key) throw new Error("Fireworks credential unavailable");
    process.env.FIREWORKS_API_KEY = key;
    const results = [];
    for (const description of selected) {
      const firstMatch = matched.length;
      let outcome: { status: number; items?: Item[]; totals?: Total; incomplete?: boolean; error?: string };
      try {
        const response = await POST(new NextRequest("http://localhost:3000/api/estimate", {
          method: "POST", headers: { Origin: "http://localhost:3000", Cookie: "mealio_session=isolated" },
          body: JSON.stringify({ description }),
        }));
        outcome = { status: response.status, ...await response.json() };
      } catch (error) { outcome = { status: 0, error: error instanceof Error ? error.message : "Unexpected error" }; }
      const items = outcome.items ?? [];
      const totals = outcome.totals ?? null;
      const grams = items.every((item) => item.grams != null)
        ? Math.round(items.reduce((sum, item) => sum + (item.grams ?? 0), 0) * 100) / 100 : null;
      const matches = matched.slice(firstMatch);
      const flags: string[] = [];
      if (outcome.status !== 200) flags.push(`HTTP ${outcome.status}: ${outcome.error ?? "estimation failed"}`);
      if (!totals || items.some((item) => item.kcal == null)) flags.push("missing calories");
      if (!totals || totals.fat == null || items.some((item) => [item.protein, item.carbs, item.fat].some((value) => value == null))) flags.push("missing macro");
      if (totals && totals.kcal <= 0) flags.push("non-positive calories");
      if (grams === null || grams < 10 || grams > 3000) flags.push("implausible/unknown total grams");
      if (totals && grams && (totals.kcal * 100 / grams > 600 || totals.kcal * 100 / grams < 10)) flags.push("unusual calorie density");
      if (/\bbowl\b/i.test(description) && totals && grams && totals.kcal * 100 / grams > 220)
        flags.push("rich cooked bowl; review dry grain, nuts and cooking oil");
      if (totals && totals.fat != null && Math.abs(totals.kcal - (totals.protein * 4 + totals.carbs * 4 + totals.fat * 9)) >
          Math.max(80, totals.kcal * .4)) flags.push("macros and energy disagree");
      if (/\blittle oil\b/i.test(description) && items.some((item) => /^(?:(?:cooking|vegetable) )?oil$/i.test(item.name) && (item.grams ?? 0) > 20))
        flags.push("qualitative cooking oil became a large separate serving");
      if (/\bsmall handful\b/i.test(description) && (grams ?? 0) > 40) flags.push("small handful estimated too large");
      const overlaps = items.some((item) => item.ingredients?.some((ingredient) => items.some((other) =>
        other !== item && ingredient.name.toLowerCase() === other.name.toLowerCase())));
      if (overlaps) flags.push("possible double-counted topping or ingredient");
      const countedSauces = /\b([2-9])\s+sauces?\b/i.exec(description);
      if (countedSauces && items.some((item) => item.source === "recipe_estimate" && item.ingredients &&
          item.ingredients.filter((entry) => /\b(sauce|chutney|dressing|mayonnaise|mayo)\b/i.test(entry.name)).length < Number(countedSauces[1]) &&
          !item.ingredients.some((entry) => /\b(assorted|mixed)\b.*\bsauces\b/i.test(entry.name))))
        flags.push("some explicitly counted sauces missing from recipe");
      if (items.some((item) => item.matchConfidence === "high" && !["usda", "indb"].includes(item.source))) flags.push("unsupported high confidence");
      if (items.some((item) => item.source === "unmatched")) flags.push("manual review instead of estimate");
      if (matches.some(({ query, description: food }) => /\bpotato\b/i.test(query) && /\b(bread|sweet potato|chips|pancakes)\b/i.test(food) ||
          /\bonion\b/i.test(query) && /\b(rings|soup)\b/i.test(food) ||
          /\bpoha\b/i.test(query) && /\bgroundcherr|gooseberr/i.test(food) ||
          /\bmilk\b/i.test(query) && /^cheese\b/i.test(food) ||
          /\bice\b/i.test(query) && /\bice cream\b/i.test(food) ||
          /\byogurt\b/i.test(query) && /\b(tofu|soy|silk)\b/i.test(food) ||
          /\bolive oil\b/i.test(query) && /\b(corn|peanut)\b/i.test(food))) flags.push("semantically wrong USDA match");
      if (/\bshake\b/i.test(description) && totals && grams && totals.protein * 100 / grams > 7 &&
          !/\b(protein powder|whey)\b/i.test(description)) flags.push("unexplained high-protein shake");
      results.push({ description, status: outcome.status,
        items: items.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit, grams: item.grams,
          kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat ?? null,
          confidence: item.matchConfidence ?? null, source: item.source,
          ingredients: item.ingredients?.map((ingredient) => ({ name: ingredient.name, source: ingredient.source, kcal: ingredient.kcal })) })),
        grams, totals, matches, flags });
      console.log(`${results.length}/${selected.length}: ${description}: ${totals ? `${totals.kcal} kcal` : "no totals"}${flags.length ? ` — ${flags.join(", ")}` : ""}`);
    }
    const file = resolve(process.cwd(), process.env.MEALIO_QA_REPORT_FILE ??
      `../worktree/mealio-real-food-qa-${Date.now()}.json`);
    await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), note: "Isolated auth; live USDA + Fireworks; private INDB catalog and owner DB excluded.", results }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    expect(results).toHaveLength(selected.length);
    expect(results.length).toBeGreaterThan(0);
    console.log(`QA findings: ${results.filter((result) => result.flags.length).length}/${selected.length} inputs flagged. Report: ${file}`);
  }, 1_200_000);
});
