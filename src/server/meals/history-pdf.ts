import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";

import type { Meal } from "@/server/db/schema";
import { historyTotals, type HistoryGroup, type HistoryOptions } from "@/lib/history";

const font = readFileSync(join(process.cwd(), "src/server/meals/fonts/NotoSansDevanagari-Regular.ttf"));
const plum = "#331e38", teal = "#007ea7", muted = "#5c7180";

export function renderHistoryPdf(groups: HistoryGroup<Meal>[], timezone: string, options: HistoryOptions, generatedAt = new Date()): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: "Mealio history", Author: "Mealio" } });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  pdf.registerFont("mealio", font).font("mealio");
  const contentWidth = pdf.page.width - 96;
  const ensureRoom = (height: number) => { if (pdf.y + height > pdf.page.height - 60) pdf.addPage(); };
  const text = (value: string, size = 10, color = plum, indent = 0) => {
    pdf.font("mealio").fontSize(size).fillColor(color).text(value, 48 + indent, pdf.y, { width: contentWidth - indent, lineGap: 2 });
  };
  const times = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const generated = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(generatedAt);
  const totals = historyTotals(groups);

  text("Mealio · Meal history", 19, teal);
  pdf.moveDown(.25);
  text(`Private export · ${generated} · ${timezone}`, 9, muted);
  const scope = [options.search.trim() && `Search: ${options.search.trim()}`, options.from && `From: ${options.from}`,
    options.through && `Through: ${options.through}`, `Sort: ${options.sort}`].filter(Boolean).join("  ·  ");
  text(scope, 9, muted);
  pdf.moveDown(.6);
  const allMeals = groups.flatMap((group) => group.meals);
  const fatTotal = allMeals.length > 0 && allMeals.every((meal) => meal.fat !== null) ?
    Math.round(allMeals.reduce((sum, meal) => sum + (meal.fat ?? 0), 0) * 100) / 100 : null;
  text(`${totals.count} ${totals.count === 1 ? "meal" : "meals"} · ${totals.days} ${totals.days === 1 ? "day" : "days"} · ${totals.kcal} kcal · P ${totals.protein} g · C ${totals.carbs} g${fatTotal === null ? "" : ` · F ${fatTotal} g`}`, 11);
  text("Saved values are snapshots. Candidate sources and uncertain portions still require review.", 9, muted);
  pdf.moveDown(.8);

  for (const group of groups) {
    ensureRoom(72);
    text(group.day, 13, teal);
    text(`${group.meals.length} ${group.meals.length === 1 ? "meal" : "meals"} · ${group.totalKcal} kcal · P ${group.totalProtein} g · C ${group.totalCarbs} g`, 9, muted);
    pdf.moveDown(.25);
    for (const meal of group.meals) {
      ensureRoom(75);
      const time = times.format(meal.eatenAt);
      text(`${time} · ${meal.description}`, 11);
      text(`${meal.kcal} kcal · P ${meal.protein} g · C ${meal.carbs} g${meal.fat === null ? " · F unknown" : ` · F ${meal.fat} g`} · ${meal.provenance}`, 9, muted, 12);
      for (const item of meal.itemSnapshots) {
        const source = item.source === "indb" ? "INDB reference recipe" : item.source === "usda" ? "USDA candidate" :
          item.source === "recipe_estimate" ? "Ingredient-based recipe estimate" : item.source;
        const portion = [item.quantity === null ? "" : String(item.quantity), item.unit ?? "", item.grams === null ? "" : `${item.grams} g`].filter(Boolean).join(" ");
        text(`${item.name}${portion ? ` (${portion})` : ""} · ${source}${item.sourceId ? ` · ${item.sourceId}` : ""}${item.matchConfidence ? ` · ${item.matchConfidence} confidence` : ""}`, 8, muted, 12);
        if (item.fat !== null && item.fat !== undefined) text(`${item.fat} g fat${item.fiber == null ? "" : ` · ${item.fiber} g fiber`}${item.sugar == null ? "" : ` · ${item.sugar} g sugar`}`, 8, muted, 12);
        if (item.uncertainty) text(`Uncertain: ${item.uncertainty}`, 8, plum, 12);
        for (const assumption of item.assumptions ?? []) text(`Assumption: ${assumption}`, 8, muted, 12);
        if (item.recipeUncertainty) text(`Recipe uncertainty: ${item.recipeUncertainty}`, 8, plum, 12);
        for (const ingredient of item.ingredients ?? []) {
          ensureRoom(35);
          text(`- ${ingredient.name}, ${ingredient.grams} g · ${ingredient.kcal ?? "?"} kcal · ${ingredient.source}`, 8, muted, 20);
        }
      }
      pdf.moveDown(.5);
    }
    pdf.moveDown(.4);
  }

  const pages = pdf.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    pdf.switchToPage(index);
    pdf.font("mealio").fontSize(8).fillColor(muted).text(`Page ${index + 1} / ${pages.count}`,
      48, pdf.page.height - 66, { width: contentWidth, align: "center", lineBreak: false });
  }
  pdf.end();
  return output;
}
