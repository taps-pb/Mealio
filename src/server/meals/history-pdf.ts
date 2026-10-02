import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";

import type { HistoryGroup, HistoryOptions } from "@/lib/history";
import type { Meal } from "@/server/db/schema";

const font = readFileSync(join(process.cwd(), "src/server/meals/fonts/NotoSansDevanagari-Regular.ttf"));
const colors = {
  teal: "#007ea7", darkTeal: "#006494", deepTeal: "#004e75", sky: "#7dd3fc",
  pale: "#f0f9ff", border: "#e0f2fe", ink: "#0f172a", muted: "#64748b",
};
const left = 45; // roughly 16 mm, on A4
const top = 40; // roughly 14 mm
const width = 595.28 - left * 2;
const timelineTop = 289;
const timelineBottom = 770;
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

type Density = { foodSize: number; kcalSize: number; timeSize: number; badgeHeight: number;
  foodOffset: number; lineGap: number; bottomPad: number; gap: number };
const densities: Density[] = [
  { foodSize: 12.5, kcalSize: 12, timeSize: 8.5, badgeHeight: 17, foodOffset: 31, lineGap: 2,
    bottomPad: 10, gap: 8 },
  { foodSize: 11.5, kcalSize: 11.5, timeSize: 8, badgeHeight: 15, foodOffset: 26, lineGap: 1.5,
    bottomPad: 7, gap: 4 },
  { foodSize: 10.5, kcalSize: 10.5, timeSize: 8, badgeHeight: 14, foodOffset: 23, lineGap: 1,
    bottomPad: 5, gap: 2 },
  { foodSize: 10, kcalSize: 10.5, timeSize: 8, badgeHeight: 14, foodOffset: 21, lineGap: .5,
    bottomPad: 2, gap: 1 },
];

/** An oversized day cannot be split without violating one-day-per-page. */
export class PdfDayOverflowError extends Error {
  constructor() {
    super("A day has too many meals to fit on one PDF page.");
    this.name = "PdfDayOverflowError";
  }
}

// Filtering and timezone selection remain with the authenticated route.
export async function renderHistoryPdf(groups: HistoryGroup<Meal>[], timezone: string, _options: HistoryOptions, _generatedAt?: Date): Promise<Buffer> {
  void _options;
  void _generatedAt;
  const pdf = new PDFDocument({ size: "A4", margins: { top, bottom: top, left, right: left },
    bufferPages: true, info: { Title: "Mealio · Daily Food Log", Author: "Mealio" } });
  pdf.registerFont("mealio", font).font("mealio");
  const clock = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true });
  const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
  const weekdayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" });
  const dayInstant = (day: string) => new Date(`${day}T12:00:00Z`); // already an owner-local calendar key
  const time = (meal: Meal) => clock.format(meal.eatenAt).replace(/\b(am|pm)\b/gi, (period) => period.toUpperCase());
  const calories = (meal: Meal) => `${number.format(meal.kcal)} kcal`;

  function measureMeal(meal: Meal, density: Density) {
    const value = calories(meal);
    const kcalWidth = Math.max(94, pdf.font("Helvetica-Bold").fontSize(density.kcalSize).widthOfString(value) + 3);
    const foodWidth = width - kcalWidth - 19;
    const foodHeight = pdf.font("mealio").fontSize(density.foodSize).heightOfString(meal.description,
      { width: foodWidth, lineGap: density.lineGap });
    const valueHeight = pdf.font("Helvetica-Bold").fontSize(density.kcalSize).heightOfString(value, { width: kcalWidth });
    return { meal, value, kcalWidth, foodWidth,
      height: density.foodOffset + Math.max(foodHeight, valueHeight) + density.bottomPad };
  }

  // Preflight the entire export before drawing: PDFKit must never auto-create
  // a continuation page or cut a saved description to meet the page contract.
  const layouts = groups.map((group) => {
    for (const density of densities) {
      const rows = group.meals.map((meal) => measureMeal(meal, density));
      const height = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * density.gap;
      if (height <= timelineBottom - timelineTop) return { group, density, rows };
    }
    pdf.end();
    throw new PdfDayOverflowError();
  });

  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  function renderTopAccent() {
    const gradient = pdf.linearGradient(0, 0, pdf.page.width, 0);
    gradient.stop(0, colors.darkTeal).stop(.55, colors.teal).stop(1, colors.sky);
    pdf.rect(0, 0, pdf.page.width, 4).fill(gradient);
  }

  function renderCalorieRing(total: number) {
    const cx = pdf.page.width - left - 67;
    const cy = 99;
    // A full ring is intentional: there is no stored calorie goal to imply progress toward.
    pdf.lineWidth(1).strokeColor(colors.border).circle(cx, cy, 62).stroke();
    pdf.lineWidth(12).strokeColor(colors.pale).circle(cx, cy, 53).stroke();
    const gradient = pdf.linearGradient(cx - 55, cy - 55, cx + 55, cy + 55);
    gradient.stop(0, colors.darkTeal).stop(.65, colors.teal).stop(1, colors.sky);
    pdf.lineWidth(11).circle(cx, cy, 53).stroke(gradient);
    const value = number.format(total);
    const textSize = Math.min(24, 24 * 87 / pdf.font("Helvetica-Bold").fontSize(24).widthOfString(value));
    pdf.font("Helvetica-Bold").fontSize(textSize).fillColor(colors.ink)
      .text(value, cx - 47, cy - 19, { width: 94, align: "center", lineBreak: false });
    pdf.font("mealio").fontSize(10).fillColor(colors.muted)
      .text("kcal", cx - 43, cy + 13, { width: 86, align: "center", lineBreak: false });
  }

  function renderDocumentHeader(group: HistoryGroup<Meal>) {
    renderTopAccent();
    pdf.roundedRect(left, 43, 22, 22, 6).fill(colors.teal);
    pdf.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
      .text("M", left, 46, { width: 22, align: "center", lineBreak: false });
    pdf.font("Helvetica-Bold").fontSize(15).fillColor(colors.ink)
      .text("Mealio", left + 31, 45, { lineBreak: false });
    pdf.fillColor(colors.teal).text(".", left + 31 + pdf.widthOfString("Mealio"), 45, { lineBreak: false });
    pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(colors.muted)
      .text("DAILY FOOD LOG", left, 79, { characterSpacing: 1.6, lineBreak: false });
    const day = dayInstant(group.day);
    pdf.font("Helvetica-Bold").fontSize(27).fillColor(colors.deepTeal)
      .text(dateFormat.format(day), left, 101, { width: 330, lineBreak: false });
    pdf.font("mealio").fontSize(10).fillColor(colors.muted)
      .text(weekdayFormat.format(day), left, 139, { lineBreak: false });
    renderCalorieRing(group.totalKcal);
    pdf.lineWidth(.8).strokeColor(colors.border).moveTo(left, 171).lineTo(left + width, 171).stroke();
  }

  function renderDailySummary(group: HistoryGroup<Meal>) {
    pdf.roundedRect(left, 185, width, 58, 7).fill(colors.pale);
    pdf.lineWidth(.7).strokeColor(colors.border).moveTo(left + width / 2, 195)
      .lineTo(left + width / 2, 233).stroke();
    pdf.font("Helvetica-Bold").fontSize(8).fillColor(colors.muted)
      .text("TOTAL CONSUMED", left + 14, 193, { characterSpacing: 1.1, lineBreak: false });
    pdf.text("MEALS LOGGED", left + width / 2 + 14, 193, { characterSpacing: 1.1, lineBreak: false });
    const total = `${number.format(group.totalKcal)} kcal`;
    const totalWidth = width / 2 - 25;
    const totalSize = Math.min(17, 17 * totalWidth / pdf.font("Helvetica-Bold").fontSize(17).widthOfString(total));
    pdf.font("Helvetica-Bold").fontSize(totalSize).fillColor(colors.deepTeal)
      .text(total, left + 14, 208, { width: totalWidth, lineBreak: false });
    pdf.font("Helvetica-Bold").fontSize(17).fillColor(colors.ink)
      .text(String(group.meals.length), left + width / 2 + 14, 208, { lineBreak: false });
  }

  function renderMealsHeading() {
    pdf.font("Helvetica-Bold").fontSize(9).fillColor(colors.darkTeal)
      .text("MEALS", left, 264, { characterSpacing: 1.4, lineBreak: false });
    pdf.lineWidth(1.5).strokeColor(colors.teal).moveTo(left, 282).lineTo(left + 28, 282).stroke();
    pdf.lineWidth(.65).strokeColor(colors.border).moveTo(left + 37, 282).lineTo(left + width, 282).stroke();
  }

  function renderMeal(row: ReturnType<typeof measureMeal>, density: Density, y: number) {
    const label = time(row.meal);
    const pillWidth = pdf.font("mealio").fontSize(density.timeSize).widthOfString(label) + 17;
    pdf.roundedRect(left, y, pillWidth, density.badgeHeight, 4).fill(colors.pale);
    pdf.font("mealio").fontSize(density.timeSize).fillColor(colors.darkTeal)
      .text(label, left + 8, y + (density.badgeHeight - density.timeSize) / 2 - 1,
        { width: pillWidth - 15, lineBreak: false });
    pdf.lineWidth(.55).strokeColor(colors.border).moveTo(left + pillWidth + 9, y + density.badgeHeight / 2)
      .lineTo(left + width, y + density.badgeHeight / 2).stroke();
    const foodY = y + density.foodOffset;
    pdf.font("mealio").fontSize(density.foodSize).fillColor(colors.ink)
      .text(row.meal.description, left, foodY, { width: row.foodWidth, lineGap: density.lineGap });
    pdf.font("Helvetica-Bold").fontSize(density.kcalSize).fillColor(colors.deepTeal)
      .text(row.value, left + width - row.kcalWidth, foodY,
        { width: row.kcalWidth, align: "right", lineBreak: false });
  }

  function renderFooter() {
    pdf.lineWidth(.55).strokeColor(colors.border).moveTo(left, 778).lineTo(left + width, 778).stroke();
    pdf.font("Helvetica-Bold").fontSize(8).fillColor(colors.muted)
      .text("Mealio · Daily Food Log", left, 785, { lineBreak: false });
  }

  layouts.forEach(({ group, density, rows }, index) => {
    if (index > 0) pdf.addPage(); // hard page break: one owner-local day per page
    renderDocumentHeader(group);
    renderDailySummary(group);
    renderMealsHeading();
    let y = timelineTop;
    for (const row of rows) {
      renderMeal(row, density, y);
      y += row.height + density.gap;
    }
    renderFooter();
  });
  if (pdf.bufferedPageRange().count !== layouts.length) {
    pdf.end();
    throw new PdfDayOverflowError();
  }
  pdf.end();
  return output;
}
