import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { addFood, addRecipe, openLibrary, openNutrition, setupJournal } from "./library-helpers";

async function storage(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mealio-food-library-v1:owner") ?? "null"));
}

test("Add Meal stays focused and browser back/forward preserves an unfinished meal", async ({ page }) => {
  await setupJournal(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByLabel("Meal description", { exact: true }).fill("My unfinished meal");
  await openNutrition(page);
  await page.getByLabel("Meal calories", { exact: true }).fill("450.25");
  for (const label of ["Food name", "Recipe name", "Ingredients (one per line)", "Import backup"]) await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  for (const name of ["Export library", "Reset local library", "Save recipe", "Remove food"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByText("Data sources & licenses", { exact: true })).toHaveCount(0);
  await openLibrary(page);
  await expect(page).toHaveURL(/\/foods$/);
  await page.goBack();
  await expect(page.getByLabel("Meal description", { exact: true })).toHaveValue("My unfinished meal");
  await openNutrition(page);
  await expect(page.getByLabel("Meal calories", { exact: true })).toHaveValue("450.25");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "My foods & recipes", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "+ Add recipe", exact: true }).click();
  await page.getByLabel("Recipe name", { exact: true }).fill("Unfinished recipe");
  await page.reload();
  await expect(page.getByLabel("Recipe name", { exact: true })).toHaveValue("Unfinished recipe");
  await page.getByRole("link", { name: "My foods & recipes", exact: true }).click();
  await page.getByRole("link", { name: "Back to meal", exact: true }).click();
  await expect(page.getByLabel("Meal description", { exact: true })).toHaveValue("My unfinished meal");
  await page.reload();
  await openNutrition(page);
  await expect(page.getByLabel("Meal calories", { exact: true })).toHaveValue("450.25");
});

test("offline library separates foods/recipes and supports confirmed delete, backup import/export and reset", async ({ page, context }) => {
  await page.goto("/nutrition");
  await expect(page.getByText("Ready for offline use on this device.", { exact: true })).toBeVisible();
  await openLibrary(page);
  await context.setOffline(true);
  await addFood(page, "Backup paratha");
  await addRecipe(page, "Backup curry");
  await expect(page.getByRole("link", { name: /Backup paratha/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Backup curry/ }).click();
  await expect(page.getByRole("heading", { name: "Backup curry", exact: true })).toBeVisible();
  await expect(page.getByText("180 g cooked · 2 servings", { exact: true })).toBeVisible();
  await expect(page.getByText("1 bowl = 90 g", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "My foods & recipes", exact: true }).click();
  await page.getByRole("link", { name: "Library settings", exact: true }).click();
  const expected = await storage(page);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export library", exact: true }).click();
  const backup = await downloaded;
  const payload = await readFile((await backup.path())!);
  expect(JSON.parse(payload.toString())).toEqual(expected);
  await page.getByRole("link", { name: "My foods & recipes", exact: true }).click();
  await page.getByLabel("Actions for Backup paratha", { exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Delete “Backup paratha”?", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await storage(page)).toEqual(expected);
  await page.getByLabel("Actions for Backup paratha", { exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: /Backup paratha/ })).toHaveCount(0);
  await page.getByRole("link", { name: /^Recipes/ }).click();
  await page.getByLabel("Actions for Backup curry", { exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete “Backup curry”?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: /Backup curry/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Library settings", exact: true }).click();
  await page.getByLabel("Import backup", { exact: false }).setInputFiles({ name: "saved-foods.json", mimeType: "application/json", buffer: payload });
  await page.getByRole("dialog").getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(page.getByText("Library imported.", { exact: true })).toBeVisible();
  const restored = await storage(page);
  expect(restored.foods).toEqual(expected.foods); expect(restored.recipes).toEqual(expected.recipes);
  await page.getByLabel("Import backup", { exact: false }).setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"invalid":true}') });
  await page.getByRole("dialog").getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid backup" })).toBeVisible();
  expect(await storage(page)).toEqual(restored);
  await page.getByRole("button", { name: "Reset local library", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Reset your local library?", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await storage(page)).toEqual(restored);
  await page.getByRole("button", { name: "Reset local library", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset library", exact: true }).click();
  await expect(page.getByText("Your local library has been reset.", { exact: true })).toBeVisible();
  expect(await storage(page)).toBeNull();
  await page.getByRole("link", { name: /About & data sources/ }).click();
  await page.getByRole("link", { name: /Data sources & licenses/ }).click();
  for (const name of ["Open Food Facts", "Open Database License", "DbCL 1.0", "USDA FoodData Central", "Subway India official nutrition", "Download adapted product database", "Full local database", "Source manifest", "Full attribution & redistribution information"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Data sources & licenses", exact: true })).toBeVisible();
});

test("ingredient builder uses local resolution and the saved yield/servings match gram estimates", async ({ page }) => {
  await page.goto("/foods");
  await addRecipe(page, "Yield test curry");
  const saved = await storage(page);
  expect(saved.recipes[0]).toMatchObject({ yieldGrams: 180, servings: 2, ingredients: [
    { amount: 100, basis: "g" }, { amount: 60, basis: "g" }, { amount: 5, basis: "g" },
  ] });
  await page.goto("/nutrition");
  const description = page.getByLabel("Meal description", { exact: true }), estimate = page.getByRole("button", { name: "Estimate locally", exact: true });
  await description.fill("1 bowl Yield test curry"); await estimate.click();
  const servingText = await page.getByLabel("Nutrition total").textContent();
  await description.fill("90 g Yield test curry"); await estimate.click();
  await expect(page.getByLabel("Nutrition total")).toHaveText(servingText!);
  await openLibrary(page);
  await page.getByRole("link", { name: "+ Add recipe", exact: true }).click();
  await expect(page.getByLabel("Recipe name", { exact: true })).toHaveValue("");
  await page.getByLabel("Ingredient", { exact: true }).fill("100 g nonexistentfoodxyz");
  await page.getByRole("button", { name: "+ Add ingredient", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "known food and portion" })).toBeVisible();
  await expect(page.getByLabel("Recipe ingredients").getByRole("listitem")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save recipe", exact: true })).toBeDisabled();
});

test("recipe preview uses exact custom-food macros and blocks deletion of an ingredient still in use", async ({ page }) => {
  await page.goto("/foods");
  await addFood(page, "Recipe base", { kcal: "200", protein: "10", carbs: "20", fat: "8" }, "g", "100");
  await page.getByRole("link", { name: "+ Add recipe", exact: true }).click();
  await page.getByLabel("Recipe name", { exact: true }).fill("Measured recipe");
  for (let index = 0; index < 2; index++) {
    await page.getByLabel("Ingredient", { exact: true }).fill("100 g Recipe base");
    await page.getByRole("button", { name: "+ Add ingredient", exact: true }).click();
  }
  await page.getByLabel("Cooked yield (g)", { exact: true }).fill("300");
  await page.getByLabel("Servings", { exact: true }).fill("4");
  const preview = page.getByRole("region", { name: "Estimated recipe nutrition", exact: true });
  await expect(preview).toContainText("400 kcal"); await expect(preview).toContainText("100 kcal");
  await expect(preview).toContainText("20 g"); await expect(preview).toContainText("5 g");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByRole("link", { name: /Measured recipe/ })).toContainText("4 servings · 400 kcal total");
  await page.getByRole("link", { name: /^Foods/ }).click();
  await page.getByLabel("Actions for Recipe base", { exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "used by a saved recipe" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Recipe base/ })).toBeVisible();
  await page.goto("/nutrition");
  await page.getByLabel("Meal description", { exact: true }).fill("75 g Measured recipe");
  await page.getByRole("button", { name: "Estimate locally", exact: true }).click();
  await expect(page.getByLabel("Nutrition total")).toHaveText("100 kcal · P 5 g · C 10 g · F 4 g");
});

for (const width of [360, 390, 412]) test(`mobile ${width}px: light/dark pages fit, names wrap and final controls clear navigation`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  await setupJournal(page);
  await page.goto("/?screen=entry");
  await page.getByLabel("Meal description", { exact: true }).fill("A meal draft that survives the library visit");
  await openLibrary(page);
  await addFood(page, "Medium Schezwan stuffed crust margherita pizza with a very long saved food name");
  await addRecipe(page, "Weekend paneer curry");
  for (const dark of [false, true]) {
    await page.evaluate((dark) => localStorage.setItem("mealio-theme", dark ? "dark" : "light"), dark);
    for (const route of ["/foods", "/foods?tab=recipes", "/foods/new", "/foods/recipes/new", "/foods/settings", "/about/sources", "/?screen=entry"]) {
      if (route === "/foods/recipes/new") await page.evaluate(() => sessionStorage.removeItem("mealio-new-recipe"));
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-theme", dark ? "dark" : "light");
      if (route.startsWith("/?")) await expect(page.getByLabel("Meal description", { exact: true })).toHaveValue("A meal draft that survives the library visit");
      else if (route === "/foods/new") await expect(page.getByLabel("Food name", { exact: true })).toBeEnabled();
      else if (route === "/foods/recipes/new") {
        await page.getByLabel("Recipe name", { exact: true }).fill("Weeknight paneer curry");
        for (const line of ["100 g paneer", "60 g tomato", "5 g oil"]) {
          await page.getByLabel("Ingredient", { exact: true }).fill(line);
          await page.getByRole("button", { name: "+ Add ingredient", exact: true }).click();
        }
        await page.getByLabel("Cooked yield (g)", { exact: true }).fill("180");
        await page.getByLabel("Servings", { exact: true }).fill("2");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const controlsFit = await page.locator("input, select, textarea").evaluateAll((controls) => controls.filter((control) => control.getBoundingClientRect().width > 0).every((control) => {
        const rect = control.getBoundingClientRect(); return rect.left >= 15 && rect.right <= window.innerWidth - 15;
      }));
      expect(controlsFit).toBe(true);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const save = page.getByRole("button", { name: /^(Save food|Save recipe|Review meal)$/ });
      if (await save.count()) {
        const box = await save.boundingBox(), nav = await page.getByRole("navigation", { name: "Main", exact: true }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
      }
      if (width === 360) await page.screenshot({ path: testInfo.outputPath(`${dark ? "dark" : "light"}-${route.replace(/[^a-z0-9]/g, "-")}.png`), fullPage: true });
    }
  }
});
