const typos: Record<string, string> = {
  kher: "kheer", lassai: "lassi", parantha: "paratha", paranthas: "paratha", parathas: "paratha",
  alu: "aloo", aalu: "aloo", pyaz: "pyaaz", margarita: "margherita", maggie: "maggi",
  peice: "piece", peices: "piece", pieces: "piece", pcs: "piece", pc: "piece", mediums: "medium",
  grams: "g", gram: "g", gm: "g", gms: "g", kilograms: "kg", kilogram: "kg",
  millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml", liters: "l", litre: "l", litres: "l", liter: "l",
  bowls: "bowl", katori: "bowl", katoris: "bowl", plates: "plate", glasses: "glass", cups: "cup",
  spoons: "spoon", slices: "slice", packets: "packet", bags: "bag", cans: "can", servings: "serving",
  idlis: "idli", rotis: "roti", samosas: "samosa", apples: "apple", oranges: "orange", bananas: "banana",
  appel: "apple", aple: "apple", aplpe: "apple", bananna: "banana", ornage: "orange", egss: "egg", eggs: "egg",
  choc: "chocolate", dou: "double", big: "large", tsp: "teaspoon", tbsp: "tablespoon",
};

/** Identity-preserving vocabulary replacements; raw input is retained separately. */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[.!?]+$/g, "").replace(/[^\p{L}\p{N}\s.+'’&,-]/gu, " ")
    .replace(/\bhome made\b/g, "homemade").replace(/\bmedium(?:s)? siz(?:e|ed)\b/g, "medium")
    .replace(/\b(?:small|large)\s+siz(?:e|ed)\b/g, (word) => word.split(" ")[0])
    .replace(/\b[\p{L}]+\b/gu, (word) => typos[word] ?? word).replace(/\s+/g, " ").trim();
}

export function gramsOfText(value: string): string[] {
  const text = ` ${normalize(value)} `;
  return [...new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)))];
}
