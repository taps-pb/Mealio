import type { InterpretedItem } from "./interpret";

/** Strict local parsing for ordinary ingredients; complex dishes use the interpreter. */
const aliases: Record<string, string> = {
  apple: "apple", apples: "apple", appel: "apple", aple: "apple",
  banana: "banana", bananas: "banana", bananna: "banana",
  egg: "egg", eggs: "egg", egss: "egg",
  orange: "orange", oranges: "orange", ornage: "orange",
  rice: "rice", milk: "milk",
};
const numbers: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, half: .5 };
const units: Record<string, string> = { g: "g", gram: "g", grams: "g", kg: "kg", cup: "cup", cups: "cup",
  glass: "glass", glasses: "glass", piece: "piece", pieces: "piece", each: "each" };

export function parseSimpleMeal(description: string): InterpretedItem[] | null {
  if (!description.trim() || description.length > 500) return null;
  const parts = description.toLowerCase().replace(/(\d)(g|kg)\b/g, "$1 $2").split(/\s*(?:,|\band\b|\+)\s*/);
  if (!parts.length || parts.length > 8 || parts.some((part) => !part.trim())) return null;
  const result: InterpretedItem[] = [];
  for (const part of parts) {
    const words = part.trim().split(/\s+/);
    const number = numbers[words[0]] ?? (/^\d+(?:\.\d+)?$/.test(words[0]) ? Number(words[0]) : null);
    if (number !== null) words.shift();
    const rawUnit = words[0] ? units[words[0]] : undefined;
    if (rawUnit) words.shift();
    const size = ["small", "medium", "large"].includes(words[0]) ? words.shift() : undefined;
    const state = ["cooked", "boiled", "raw"].includes(words[0]) ? words.shift() : undefined;
    if (words.length !== 1 || !aliases[words[0]] || (number !== null && (number <= 0 || number > (rawUnit === "g" || rawUnit === "kg" ? 10000 : 100)))) return null;
    const food = aliases[words[0]];
    if (food === "rice" && state !== "cooked" && state !== "boiled") return null;
    if (rawUnit === "kg" && number !== null && number > 10) return null;
    const grams = rawUnit === "g" && number !== null ? number : rawUnit === "kg" && number !== null ? number * 1000 : null;
    const unit = rawUnit && rawUnit !== "g" && rawUnit !== "kg" ? rawUnit : size ?? null;
    result.push({ name: `${state ? `${state} ` : ""}${food}`, quantity: grams === null ? number ?? 1 : null, unit, grams,
      uncertainty: null });
  }
  return result;
}
