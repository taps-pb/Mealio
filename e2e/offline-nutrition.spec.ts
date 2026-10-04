import { chromium, expect, test } from "@playwright/test";

test("cached production page estimates and learns foods through offline reloads", async ({ page, context }) => {
  await page.goto("/nutrition");
  await expect(page.getByText("Ready for offline use on this device.", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Estimate locally (offline)", exact: true })).toBeDisabled();
  await page.getByLabel("Meal description", { exact: true }).fill("30 g Chocos + 200 ml milk");
  await page.evaluate(() => {
    const forbidden = () => { throw new Error("Estimation attempted a network request"); };
    window.fetch = forbidden;
    XMLHttpRequest.prototype.open = forbidden;
  });
  await page.getByRole("button", { name: "Estimate locally (offline)", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("kcal");
  await expect(page.getByText(/Needs clarification/)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("NaN");

  await page.getByText("My local foods & recipes", { exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Jimmy Jam");
  await page.getByLabel("Calories", { exact: true }).fill("42");
  await page.getByLabel("Protein (g)", { exact: true }).fill("0.5");
  await page.getByLabel("Carbs (g)", { exact: true }).fill("7");
  await page.getByLabel("Fat (g)", { exact: true }).fill("1.3");
  await page.getByRole("button", { name: "Save custom food", exact: true }).click();
  await page.reload();
  await page.getByLabel("Meal description", { exact: true }).fill("10 pieces Jimmy Jam");
  await page.getByRole("button", { name: "Estimate locally (offline)", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("420 kcal");

  await page.getByLabel("Meal description", { exact: true }).fill("Dairy milk 26 rupees");
  await page.getByRole("button", { name: "Estimate locally (offline)", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("clarification");
  await page.getByLabel("Search local foods", { exact: true }).fill("Dairy Milk");
  await page.getByLabel("Food or product", { exact: true }).selectOption("off-7622201149406");
  await page.getByLabel("Total consumed (g)", { exact: true }).fill("20");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Use this interpretation", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("106.8 kcal");
  await page.reload();
  await page.getByLabel("Meal description", { exact: true }).fill("Dairy milk 26 rupees");
  await page.getByRole("button", { name: "Estimate locally (offline)", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("106.8 kcal");

  await page.getByText("My local foods & recipes", { exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Mom's Paneer Curry");
  await page.getByLabel("Aliases, separated by commas", { exact: true }).fill("mom paneer");
  await page.getByLabel("Serving unit", { exact: true }).selectOption("bowl");
  await page.getByText("Custom recipe — calculate from local ingredients", { exact: true }).click();
  await page.getByLabel("Ingredients (one per line)", { exact: true }).fill("100 g paneer\n60 g tomato\n5 g oil");
  await page.getByLabel("Cooked yield (g)", { exact: true }).fill("180");
  await page.getByRole("button", { name: "Save custom recipe", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await page.reload();
  await page.getByLabel("Meal description", { exact: true }).fill("1 bowl mom paneer");
  await page.getByRole("button", { name: "Estimate locally (offline)", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toContainText("kcal");
  await expect(page.getByText(/Needs clarification/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("offline-mobile.png"), fullPage: true });
});

test("local library and installed offline shell survive a real browser restart", async ({}, testInfo) => {
  const profile = testInfo.outputPath("synthetic-browser-profile");
  let context = await chromium.launchPersistentContext(profile);
  try {
    let page = await context.newPage();
    await page.goto("http://127.0.0.1:3100/nutrition");
    await expect(page.getByText("Ready for offline use on this device.", { exact: true })).toBeVisible();
    await page.getByText("My local foods & recipes", { exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Restart Biscuit");
    for (const [label, value] of [["Calories", "40"], ["Protein (g)", "1"], ["Carbs (g)", "6"], ["Fat (g)", "1.5"]]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Save custom food", exact: true }).click();
    await expect(page.getByText("Saved on this device. Estimate again to use updated foods.", { exact: true })).toBeVisible();
    await context.close();
    context = await chromium.launchPersistentContext(profile, { offline: true });
    page = await context.newPage();
    await page.goto("http://127.0.0.1:3100/nutrition");
    await page.getByLabel("Meal description", { exact: true }).fill("2 pieces Restart Biscuit");
    await page.getByRole("button", { name: "Estimate locally (offline)", exact: true }).click();
    await expect(page.getByLabel("Nutrition total")).toContainText("80 kcal");
  } finally { await context.close(); }
});

test("journal integrates local estimates, preserves manual totals, saves versioned snapshots and reloads history", async ({ page }) => {
  const logged: Record<string, unknown>[] = [];
  const estimateRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/estimate")) estimateRequests.push(request.url()); });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { username: "synthetic-owner", timezone: "Asia/Kolkata" } }));
  await page.route("**/api/meals**", async (route) => {
    if (route.request().method() === "POST") {
      const meal = { ...route.request().postDataJSON(), id: "synthetic-meal", createdAt: new Date().toISOString() };
      logged.push(meal); await route.fulfill({ status: 201, json: { meal } });
    } else {
      const groups = logged.length ? [{ date: "2026-10-04", day: "2026-10-04", meals: logged, totalKcal: 999, totalProtein: 9, totalCarbs: 19 }] : [];
      await route.fulfill({ json: { groups, todayKey: "2026-10-04", timezone: "Asia/Kolkata" } });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByLabel("Meal description", { exact: true }).fill("2 aloo pyaaz paratha");
  await page.getByLabel("Meal calories", { exact: true }).fill("999");
  await page.getByLabel("Meal protein (g)", { exact: true }).fill("9");
  await page.getByLabel("Meal carbs (g)", { exact: true }).fill("19");
  await page.getByRole("button", { name: "Estimate locally (offline)", exact: true }).click();
  await expect(page.getByLabel("Meal calories", { exact: true })).toHaveValue("999");
  await page.getByRole("button", { name: "Review meal", exact: true }).click();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({ description: "2 aloo pyaaz paratha", kcal: 999, protein: 9, carbs: 19, provenance: "corrected",
    itemSnapshots: [{ source: "local", sourceId: "recipe-aloo-pyaaz-paratha", local: { rawText: "2 aloo pyaaz paratha", method: "alias" } }] });
  expect(estimateRequests).toEqual([]);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("2 aloo pyaaz paratha", { exact: true }).first()).toBeVisible();
});
