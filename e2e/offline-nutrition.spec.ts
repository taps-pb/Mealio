import { chromium, expect, test } from "@playwright/test";
import { addFood, addRecipe, openLibrary, openNutrition, setupJournal } from "./library-helpers";

test("offline document routes estimate, teach foods, build recipes and preserve drafts", async ({ page, context }) => {
  await page.goto("/nutrition");
  await expect(page.getByText("Ready for offline use on this device.", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel("Meal description", { exact: true }).fill("30 g Chocos + 200 ml milk");
  await page.evaluate(() => {
    const forbidden = () => { throw new Error("Estimation attempted a network request"); };
    window.fetch = forbidden; XMLHttpRequest.prototype.open = forbidden;
  });
  await page.getByRole("button", { name: "Estimate locally", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("kcal");
  await expect(page.getByText(/Needs clarification/)).toHaveCount(0);

  await openLibrary(page);
  await addFood(page, "Jimmy Jam", { kcal: "42", protein: "0.5", carbs: "7", fat: "1.3" });
  await page.reload();
  await expect(page.getByRole("link", { name: /Jimmy Jam/ })).toBeVisible();
  await page.getByRole("link", { name: "Back to estimator" }).click();
  await expect(page.getByLabel("Meal description", { exact: true })).toHaveValue("30 g Chocos + 200 ml milk");
  await page.getByLabel("Meal description", { exact: true }).fill("10 pieces Jimmy Jam");
  await page.getByRole("button", { name: "Estimate locally", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("420 kcal");

  await page.getByLabel("Meal description", { exact: true }).fill("Dairy milk 26 rupees");
  await page.getByRole("button", { name: "Estimate locally", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("clarification");
  await page.getByLabel("Search local foods", { exact: true }).fill("Dairy Milk");
  await page.getByLabel("Food or product", { exact: true }).selectOption("off-7622201149406");
  await page.getByLabel("Total consumed (g)", { exact: true }).fill("20");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Use this interpretation", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("106.8 kcal");
  await page.reload();
  await page.getByRole("button", { name: "Estimate locally", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("106.8 kcal");

  await openLibrary(page);
  await addRecipe(page, "Mom's Paneer Curry");
  await page.reload();
  await expect(page.getByRole("link", { name: /Mom's Paneer Curry/ })).toContainText("2 servings");
  await page.getByRole("link", { name: "Back to estimator" }).click();
  await page.getByLabel("Meal description", { exact: true }).fill("1 bowl Mom's Paneer Curry");
  await page.getByRole("button", { name: "Estimate locally", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("kcal");
  await expect(page.getByText(/Needs clarification/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The wider worker scope still only caches public allowlisted documents.
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)))).flat());
  expect(cached).toContain("/foods/recipes/new");
  expect(cached).not.toContain("/");
  expect(cached.some((path) => path.startsWith("/api/"))).toBe(false);
});

test("dedicated library and offline shell survive a real browser restart", async ({}, testInfo) => {
  const profile = testInfo.outputPath("synthetic-browser-profile");
  let context = await chromium.launchPersistentContext(profile);
  try {
    let page = await context.newPage();
    await page.goto("http://127.0.0.1:3100/nutrition");
    await expect(page.getByText("Ready for offline use on this device.", { exact: true })).toBeVisible();
    await openLibrary(page);
    await addFood(page, "Restart Biscuit", { kcal: "40", protein: "1", carbs: "6", fat: "1.5" });
    await context.close();
    context = await chromium.launchPersistentContext(profile, { offline: true });
    page = await context.newPage();
    await page.goto("http://127.0.0.1:3100/foods");
    await expect(page.getByRole("link", { name: /Restart Biscuit/ })).toBeVisible();
    await page.goto("http://127.0.0.1:3100/nutrition");
    await page.getByLabel("Meal description", { exact: true }).fill("2 pieces Restart Biscuit");
    await page.getByRole("button", { name: "Estimate locally", exact: true }).click();
    await expect(page.getByLabel("Nutrition total")).toContainText("80 kcal");
  } finally { await context.close(); }
});

test("journal keeps manual totals, versioned snapshots and review/save/history after a library visit", async ({ page }) => {
  const { logged, estimateRequests } = await setupJournal(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByLabel("Meal description", { exact: true }).fill("2 aloo pyaaz paratha");
  await openNutrition(page);
  await page.getByLabel("Meal calories", { exact: true }).fill("999");
  await page.getByLabel("Meal protein (g)", { exact: true }).fill("9");
  await page.getByLabel("Meal carbs (g)", { exact: true }).fill("19");
  await page.getByRole("button", { name: /^Change meal time:/ }).click();
  const when = page.getByLabel("Date & time", { exact: true });
  await when.fill("2026-10-05T23:55");
  await page.getByRole("button", { name: "Hide nutrition", exact: true }).click();
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save meal", exact: true })).toBeVisible();
  await openLibrary(page);
  await page.getByRole("link", { name: "Back to meal" }).click();
  await openNutrition(page);
  await expect(page.getByLabel("Meal calories", { exact: true })).toHaveValue("999");
  await page.getByRole("button", { name: /^Change meal time:/ }).click();
  await expect(when).toHaveValue("2026-10-05T23:55");
  await page.getByRole("button", { name: "Review meal", exact: true }).click();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({ description: "2 aloo pyaaz paratha", kcal: 999, protein: 9, carbs: 19, provenance: "corrected",
    itemSnapshots: [{ source: "local", sourceId: "recipe-aloo-pyaaz-paratha", local: { rawText: "2 aloo pyaaz paratha", method: "alias" } }] });
  expect(estimateRequests).toEqual([]);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("2 aloo pyaaz paratha", { exact: true }).first()).toBeVisible();
});
