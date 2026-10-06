import { expect, test } from "@playwright/test";
import { openNutrition, setupJournal } from "./library-helpers";

test("390px minimal empty, estimated, manual and time-editor screenshots", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupJournal(page);
  await page.goto("/?screen=entry");
  await expect(page.getByRole("button", { name: "Estimate", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Meal description", { exact: true })).toBeVisible();
  await expect(page.getByText("NEW MEAL", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review meal", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save meal", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Meal calories", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Date & time", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Add meal", exact: true })).not.toContainText(/Asia\/|Database 1-|Food text stays/);
  expect(await page.getByLabel("Meal description", { exact: true }).evaluate((input) => input.getBoundingClientRect().height)).toBeLessThanOrEqual(96);
  await page.screenshot({ path: testInfo.outputPath("01-empty-390.png"), fullPage: true, animations: "disabled" });

  await page.getByLabel("Meal description", { exact: true }).fill("2 aloo pyaaz paratha");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByRole("region", { name: "Meal nutrition summary", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save meal", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Estimate", exact: true })).not.toBeVisible();
  await expect(page.getByLabel("Food name", { exact: true }).first()).not.toBeVisible();
  await expect(page.getByLabel("Meal calories", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("02-estimated-390.png"), fullPage: true, animations: "disabled" });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByLabel("Meal description", { exact: true }).fill("Lunch from home");
  await openNutrition(page);
  await expect(page.getByRole("group", { name: "Manual meal nutrition", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Manual meal nutrition", exact: true })).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("03-manual-390.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Hide nutrition", exact: true }).click();
  await page.getByRole("button", { name: /^Change meal time:/ }).click();
  await expect(page.getByLabel("Date & time", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("04-time-390.png"), fullPage: true, animations: "disabled" });
});

test("type → estimate → save uses the local result and prevents duplicate estimates", async ({ page }) => {
  const { logged, estimateRequests } = await setupJournal(page);
  await page.goto("/?screen=entry");
  await page.getByLabel("Meal description", { exact: true }).fill("100 g apple");
  await expect(page.getByRole("button", { name: "Estimate", exact: true })).toBeEnabled();
  const loading = await page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find((button) => button.textContent === "Estimate")!;
    button.click(); button.click(); await Promise.resolve();
    return { disabled: button.disabled, busy: button.getAttribute("aria-busy"), text: button.textContent };
  });
  expect(loading).toEqual({ disabled: true, busy: "true", text: "Estimating…" });
  const summary = page.getByRole("region", { name: "Meal nutrition summary", exact: true });
  await expect(summary).toBeVisible();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({ description: "100 g apple", provenance: "estimated", itemSnapshots: [{ source: "local", grams: 100 }] });
  const items = logged[0].itemSnapshots as { kcal: number; protein: number; carbs: number }[];
  expect(logged[0].kcal).toBe(Math.round(items[0].kcal * 100) / 100);
  expect(logged[0].protein).toBe(Math.round(items[0].protein * 100) / 100);
  expect(estimateRequests).toEqual([]);
});

test("manual disclosure can collapse without losing values and only complete entries reveal review", async ({ page }) => {
  const { logged } = await setupJournal(page);
  await page.goto("/?screen=entry");
  await page.getByLabel("Meal description", { exact: true }).fill("My label-based meal");
  await openNutrition(page);
  await page.getByLabel("Meal calories", { exact: true }).fill("321.25");
  await expect(page.getByRole("button", { name: "Review meal", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide nutrition", exact: true }).click();
  await openNutrition(page);
  await expect(page.getByLabel("Meal calories", { exact: true })).toHaveValue("321.25");
  await page.getByLabel("Meal protein (g)", { exact: true }).fill("12.5");
  await page.getByLabel("Meal carbs (g)", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Review meal", exact: true }).click();
  await expect(page.getByRole("region", { name: "Meal nutrition summary", exact: true })).toContainText("321.3");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({ kcal: 321.25, protein: 12.5, carbs: 40, fat: null, provenance: "corrected" });
});

test("unknown foods show a compact recoverable error without source/debug text", async ({ page }) => {
  const { logged } = await setupJournal(page);
  await page.goto("/?screen=entry");
  await page.getByLabel("Meal description", { exact: true }).fill("some unknown food xyz");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn’t estimate the whole meal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save meal", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Search local foods", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Enter nutrition manually", exact: true }).click();
  await expect(page.getByLabel("Meal calories", { exact: true })).toBeVisible();
  expect(logged).toEqual([]);
});

test("editing a saved meal keeps the exact eaten-at instant when the compact time row is untouched", async ({ page }) => {
  await setupJournal(page);
  const original = "2026-10-05T18:29:45.123Z";
  let saved: Record<string, unknown> | undefined;
  const meal = { id: "existing", description: "Saved dinner", kcal: 300, protein: 10, carbs: 40, fat: null, itemSnapshots: [], provenance: "manual", eatenAt: original };
  await page.route("**/api/meals**", async (route) => {
    if (route.request().method() === "PUT") { saved = route.request().postDataJSON(); await route.fulfill({ json: { meal: { ...meal, ...saved } } }); }
    else await route.fulfill({ json: { todayKey: "2026-10-05", timezone: "Asia/Kolkata", groups: [{ day: "2026-10-05", meals: [meal], totalKcal: 300, totalProtein: 10, totalCarbs: 40 }] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Change meal time:/ })).toBeVisible();
  await expect(page.getByLabel("Date & time", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Review meal", exact: true }).click();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(() => saved?.eatenAt).toBe(original);
});

test("disclosed food resolution still remembers portions and returns to compact review", async ({ page }) => {
  await setupJournal(page);
  await page.goto("/?screen=entry");
  await page.getByLabel("Meal description", { exact: true }).fill("Dairy milk 26 rupees");
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await page.getByText("Choose foods & portions", { exact: true }).click();
  await page.getByLabel("Search local foods", { exact: true }).fill("Dairy Milk");
  await page.getByLabel("Food or product", { exact: true }).selectOption("off-7622201149406");
  await page.getByLabel("Total consumed (g)", { exact: true }).fill("20");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Use this interpretation", exact: true }).click();
  await expect(page.getByRole("region", { name: "Meal nutrition summary", exact: true })).toContainText("106.8");
  await page.reload();
  await expect(page.getByRole("button", { name: "Save meal", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit meal", exact: true }).click();
  await page.getByRole("button", { name: "Estimate", exact: true }).click();
  await expect(page.getByRole("region", { name: "Meal nutrition summary", exact: true })).toContainText("106.8");
});

for (const width of [360, 390, 412]) test(`minimal disclosures and result fit at ${width}px in both themes`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await setupJournal(page);
  await page.goto("/?screen=entry");
  for (const dark of [false, true]) {
    if (dark) {
      await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Add meal", exact: true }).click();
    }
    await openNutrition(page);
    await page.getByRole("button", { name: /^Change meal time:/ }).click();
    await expect(page.getByLabel("Date & time", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("input:visible, textarea:visible").evaluateAll((inputs) => inputs.every((input) => {
      const box = input.getBoundingClientRect(); return box.left >= 16 && box.right <= innerWidth - 16 && box.height >= 44;
    }))).toBe(true);
    await page.getByRole("button", { name: "Hide nutrition", exact: true }).click();
    await page.getByLabel("Meal description", { exact: true }).fill("100 g apple");
    await page.getByRole("button", { name: "Estimate", exact: true }).click();
    await expect(page.getByRole("region", { name: "Meal nutrition summary", exact: true })).toBeVisible();
    const save = page.getByRole("button", { name: "Save meal", exact: true });
    await save.scrollIntoViewIfNeeded();
    const saveBox = await save.boundingBox(), nav = await page.getByRole("navigation", { name: "Main", exact: true }).boundingBox();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(nav!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
