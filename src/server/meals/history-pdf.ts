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
// PDFKit uses points: approximately 16 mm horizontally and 14 mm vertically.
const horizontalMargin = 45;
const verticalMargin = 40;
const cardPadding = 12;
const cardGap = 8;
const foodSize = 12.5;
const foodLineGap = 2;
const dateSize = 14.5;
const timeSize = 8.5;
const kcalSize = 12.5;

// Filtering and timezone selection stay with the authenticated export route;
// only the four diary fields are rendered here. Keep the route's call signature.
export function renderHistoryPdf(groups: HistoryGroup<Meal>[], timezone: string, _options: HistoryOptions, _generatedAt?: Date): Promise<Buffer> {
  void _options;
  void _generatedAt;
  const pdf = new PDFDocument({ size: "A4", margins: { top: verticalMargin, bottom: verticalMargin,
    left: horizontalMargin, right: horizontalMargin },
    info: { Title: "Mealio · Meal History", Author: "Mealio" } });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  pdf.registerFont("mealio", font).font("mealio");
  const width = pdf.page.width - horizontalMargin * 2;
  const contentBottom = pdf.page.height - verticalMargin - 10;
  const formatTime = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true });
  const formatDate = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
  const dateLabel = (key: string) => formatDate.format(new Date(`${key}T12:00:00Z`)); // already an owner-local day
  const timeLabel = (date: Date) => formatTime.format(date).replace(/\b(am|pm)\b/gi, (period) => period.toUpperCase());
  // Keep the saved words, but avoid hard line breaks producing a taller-than-page card.
  const foodLabel = (meal: Meal) => meal.description.replace(/\s+/gu, " ").trim();
  const calorieLabel = (meal: Meal) => `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(meal.kcal)} kcal`;
  let y = verticalMargin;

  function renderTopAccent() {
    const gradient = pdf.linearGradient(0, 0, pdf.page.width, 0);
    gradient.stop(0, colors.darkTeal).stop(.55, colors.teal).stop(1, colors.sky);
    pdf.rect(0, 0, pdf.page.width, 4).fill(gradient);
  }

  function startPage() {
    pdf.addPage();
    renderTopAccent();
    y = verticalMargin;
  }

  function renderDocumentHeader() {
    renderTopAccent();
    const iconSize = 22;
    pdf.roundedRect(horizontalMargin, y, iconSize, iconSize, 6).fill(colors.teal);
    pdf.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff").text("M", horizontalMargin, y + 3,
      { width: iconSize, align: "center", lineBreak: false });
    const brandX = horizontalMargin + iconSize + 8;
    pdf.font("Helvetica-Bold").fontSize(17).fillColor(colors.ink).text("Mealio", brandX, y + 1,
      { lineBreak: false });
    pdf.fillColor(colors.teal).text(".", brandX + pdf.widthOfString("Mealio"), y + 1, { lineBreak: false });
    y += iconSize + 8;
    pdf.font("Helvetica-Bold").fontSize(18).fillColor(colors.darkTeal).text("Meal History", horizontalMargin, y,
      { width, lineBreak: false });
    y += 30;
    pdf.lineWidth(.7).strokeColor(colors.border).moveTo(horizontalMargin, y)
      .lineTo(horizontalMargin + width, y).stroke();
    y += 15;
  }

  function dateHeight(label: string) {
    return pdf.font("mealio").fontSize(dateSize).heightOfString(label, { width }) + 13;
  }

  function renderDateHeader(label: string) {
    pdf.font("mealio").fontSize(dateSize).fillColor(colors.deepTeal).text(label, horizontalMargin, y, { width });
    const textBottom = y + dateHeight(label) - 13;
    pdf.lineWidth(.7).strokeColor(colors.border).moveTo(horizontalMargin, textBottom + 2)
      .lineTo(horizontalMargin + width, textBottom + 2).stroke();
    y = textBottom + 13;
  }

  function measureCard(meal: Meal) {
    const calories = calorieLabel(meal);
    const label = foodLabel(meal);
    const caloriesWidth = Math.max(94, pdf.font("Helvetica-Bold").fontSize(kcalSize).widthOfString(calories) + 2);
    const textWidth = width - cardPadding * 2 - caloriesWidth - 14;
    const foodHeight = pdf.font("mealio").fontSize(foodSize).heightOfString(label,
      { width: textWidth, lineGap: foodLineGap });
    const kcalHeight = pdf.font("Helvetica-Bold").fontSize(kcalSize).heightOfString(calories, { width: caloriesWidth });
    return { label, calories, caloriesWidth, textWidth,
      height: cardPadding + 19 + 7 + Math.max(foodHeight, kcalHeight) + cardPadding };
  }

  function renderTimeBadge(time: string, x: number, top: number) {
    const textWidth = pdf.font("mealio").fontSize(timeSize).widthOfString(time);
    const badgeWidth = textWidth + 34;
    pdf.roundedRect(x, top, badgeWidth, 19, 5).fill(colors.pale);
    const centerX = x + 11;
    const centerY = top + 9.5;
    pdf.lineWidth(.9).strokeColor(colors.darkTeal).circle(centerX, centerY, 4).stroke();
    pdf.moveTo(centerX, centerY - 2.4).lineTo(centerX, centerY).lineTo(centerX + 2, centerY + 1.4).stroke();
    pdf.font("mealio").fontSize(timeSize).fillColor(colors.darkTeal).text(time, x + 21, top + 3,
      { width: badgeWidth - 26, lineBreak: false });
  }

  function renderMealCard(meal: Meal, card: ReturnType<typeof measureCard>) {
    const x = horizontalMargin;
    pdf.lineWidth(.8).roundedRect(x, y, width, card.height, 9).fillAndStroke("#ffffff", colors.border);
    renderTimeBadge(timeLabel(meal.eatenAt), x + cardPadding, y + cardPadding);
    const foodY = y + cardPadding + 19 + 7;
    pdf.font("mealio").fontSize(foodSize).fillColor(colors.ink).text(card.label,
      x + cardPadding, foodY, { width: card.textWidth, lineGap: foodLineGap });
    pdf.font("Helvetica-Bold").fontSize(kcalSize).fillColor(colors.deepTeal).text(card.calories,
      x + width - cardPadding - card.caloriesWidth, foodY,
      { width: card.caloriesWidth, align: "right", lineBreak: false });
    y += card.height + cardGap;
  }

  renderDocumentHeader();
  let hasGroup = false;
  for (const group of groups) {
    if (!group.meals.length) continue;
    const date = dateLabel(group.day);
    const firstCard = measureCard(group.meals[0]);
    if (y + (hasGroup ? 10 : 0) + dateHeight(date) + firstCard.height > contentBottom) startPage();
    else if (hasGroup) y += 10;
    renderDateHeader(date);
    for (const meal of group.meals) {
      const card = measureCard(meal);
      if (y + card.height > contentBottom) { startPage(); renderDateHeader(date); }
      renderMealCard(meal, card);
    }
    hasGroup = true;
  }

  pdf.end();
  return output;
}
