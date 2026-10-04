import { normalize } from "./normalize";
import type { ParsedItem } from "./types";

const numbers: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: .5, quarter: .25 };
const units = new Set(["g", "kg", "ml", "l", "piece", "slice", "bowl", "plate", "glass", "cup", "spoon", "teaspoon", "tablespoon", "packet", "bag", "can", "serving"]);
const modifierPattern = /\b(homemade|restaurant|little oil|less oil|extra oil|no oil|deep fried|fried|boiled|grilled|roasted|sweetened|unsweetened|without sugar|with milk)\b/g;

export function parseItem(rawText: string): ParsedItem {
  const normalizedText = normalize(rawText);
  let rest = normalizedText;
  let quantity = 1, explicitQuantity = false;
  const takeNumber = () => {
    const first = rest.split(" ")[0];
    const value = numbers[first] ?? (/^\d+(?:\.\d+)?$/.test(first) ? Number(first) : null);
    if (value !== null) { rest = rest.slice(first.length).trim(); return value; }
    return null;
  };
  // Length is a restaurant variant, never mass or count; barcode is an identity.
  let variant: string | null = null;
  rest = rest.replace(/\b(15|30)\s*cm\b/g, (_, size) => { variant = `${size} cm`; return " "; }).trim();
  if (!/^\d{8,14}$/.test(rest)) {
    const first = takeNumber();
    if (first !== null) { quantity = first; explicitQuantity = true; }
    if (/^(half|quarter)\b/.test(rest)) quantity *= takeNumber()!;
    rest = rest.replace(/^(?:a|an)\s+/, "");
  }
  let size: string | null = null, unit: string | null = null;
  // Both "small bowl" and "bowl small" are accepted; no universal portion mass.
  for (let i = 0; i < 3; i++) {
    const first = rest.split(" ")[0];
    if (["small", "medium", "large", "full"].includes(first)) size = first === "full" ? null : first;
    else if (units.has(first)) unit = first;
    else break;
    rest = rest.slice(first.length).trim();
  }
  rest = rest.replace(/^of\s+/, "");
  // Trailing package labels: "cornitos small bag", "180 ml fanta can".
  rest = rest.replace(/\s+(?:(small|medium|large)\s+)?(bag|packet|can)$/, (_, s, u) => {
    if (!unit) { unit = u; size = s ?? size; }
    return "";
  });
  const price = /\b(?:rupees?|rs|inr)\b|₹/.test(normalizedText + " " + rawText);
  const modifiers = [...rest.matchAll(modifierPattern)].map((m) => m[0]);
  // Keep modifiers in the identity for exact prepared-food matches. Resolver may
  // strip them only with explicit uncertainty (never invent a macro adjustment).
  return { rawText: rawText.trim(), normalizedText, food: rest.replace(/\s+/g, " ").trim(), quantity, explicitQuantity,
    unit, size, variant, modifiers, price,
    ...(!rest || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 ? { error: "Enter a food and a positive supported quantity." } : {}) };
}

/** Protect known compound dishes before considering conjunction boundaries. */
export function parseMeal(raw: string, compoundPhrases: string[] = ["rajma and chawal", "dal and chawal", "chole and chawal"]): ParsedItem[] {
  if (!raw.trim() || raw.length > 500) throw new Error("Enter 1–500 characters of meal text.");
  const protectedRanges: [number, number][] = [];
  for (const phrase of [...compoundPhrases].sort((a, b) => b.length - a.length)) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of raw.matchAll(new RegExp(`\\b${escaped}\\b`, "gi"))) protectedRanges.push([match.index!, match.index! + match[0].length]);
  }
  const boundaries = [...raw.matchAll(/[,;+&\n]|\band\b/gi)].filter((match) =>
    !protectedRanges.some(([start, end]) => match.index! >= start && match.index! < end));
  const chunks: string[] = []; let last = 0;
  for (const match of boundaries) { chunks.push(raw.slice(last, match.index)); last = match.index! + match[0].length; }
  chunks.push(raw.slice(last));
  if (chunks.some((chunk) => !chunk.trim()) || chunks.length > 20) throw new Error("Enter up to 20 foods without empty separators.");
  return chunks.map(parseItem);
}
