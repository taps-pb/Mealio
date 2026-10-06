import { expect, type Page } from "@playwright/test";

export async function openLibrary(page: Page) {
  if (await page.getByRole("button", { name: "Edit meal", exact: true }).isVisible()) await page.getByRole("button", { name: "Edit meal", exact: true }).click();
  await page.getByRole("link", { name: /^My foods & recipes/ }).click();
  await expect(page.getByRole("heading", { name: "My foods & recipes", exact: true })).toBeVisible();
}
export async function openNutrition(page: Page) {
  if (!(await page.getByLabel("Meal calories", { exact: true }).isVisible())) await page.getByRole("button", { name: /^(Enter nutrition manually|Edit nutrition)$/ }).click();
}
export async function addFood(page: Page, name: string, values = { kcal: "200", protein: "10", carbs: "20", fat: "8" }, unit = "piece", amount = "1") {
  await page.getByRole("link", { name: "+ Add food", exact: true }).click();
  await page.getByLabel("Food name", { exact: true }).fill(name);
  await page.getByLabel("Serving amount", { exact: true }).fill(amount);
  await page.getByLabel("Serving unit", { exact: true }).selectOption(unit);
  for (const [label, value] of [["Calories (kcal)", values.kcal], ["Protein (g)", values.protein], ["Carbohydrates (g)", values.carbs], ["Fat (g)", values.fat]]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save food", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My foods & recipes", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
}
export async function addRecipe(page: Page, name: string) {
  await page.getByRole("link", { name: "+ Add recipe", exact: true }).click();
  await page.getByLabel("Recipe name", { exact: true }).fill(name);
  for (const line of ["100 g paneer", "60 g tomato", "5 g oil"]) {
    await page.getByLabel("Ingredient", { exact: true }).fill(line);
    await page.getByRole("button", { name: "+ Add ingredient", exact: true }).click();
  }
  await expect(page.getByLabel("Recipe ingredients").getByRole("listitem")).toHaveCount(3);
  await page.getByLabel("Cooked yield (g)", { exact: false }).fill("180");
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await page.getByLabel("Serving unit", { exact: false }).selectOption("bowl");
  await expect(page.getByRole("region", { name: "Estimated recipe nutrition" })).toContainText("Per serving · 1 of 2");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My foods & recipes", exact: true })).toBeVisible();
}
export async function setupJournal(page: Page) {
  const logged: Record<string, unknown>[] = [], estimateRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/estimate")) estimateRequests.push(request.url()); });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { username: "preview-owner", timezone: "Asia/Kolkata" } }));
  await page.route("**/api/meals**", async (route) => {
    if (route.request().method() === "POST") {
      const meal = { ...route.request().postDataJSON(), id: "synthetic-meal", createdAt: new Date().toISOString() };
      logged.push(meal); await route.fulfill({ status: 201, json: { meal } });
    } else {
      const groups = logged.length ? [{ date: "2026-10-05", day: "2026-10-05", meals: logged, totalKcal: 999, totalProtein: 9, totalCarbs: 19 }] : [];
      await route.fulfill({ json: { groups, todayKey: "2026-10-06", timezone: "Asia/Kolkata" } });
    }
  });
  return { logged, estimateRequests };
}
