import { FoodCatalog, convertAmount } from "./catalog";
import { scaleNutrition, sumNutrition } from "./calculate";
import { normalize } from "./normalize";
import { parseMeal } from "./parser";
import { emptyUserData, type Catalog, type Estimate, type Food, type ParsedItem, type Resolution, type UserData } from "./types";

export class NutritionEngine {
  readonly catalog: FoodCatalog;
  private readonly cache = new Map<string, Resolution>();
  constructor(data: Catalog, readonly user: UserData = emptyUserData()) {
    this.catalog = new FoodCatalog({ ...data, foods: [...data.foods, ...user.foods], aliases: [...data.aliases, ...user.aliases],
      portions: [...data.portions, ...user.portions], recipes: [...data.recipes, ...user.recipes] });
  }

  estimate(rawText: string): Estimate {
    const parsed = parseMeal(rawText, this.catalog.compoundPhrases);
    const items = parsed.map((item) => this.resolve(item));
    const complete = items.every((item) => item.nutrition !== null && item.status === "resolved");
    return { rawText, databaseVersion: this.catalog.data.version, userVersion: this.user.revision, items,
      totals: complete ? sumNutrition(items.map((item) => item.nutrition!)) : null, incomplete: !complete };
  }

  resolve(parsed: ParsedItem): Resolution {
    const key = JSON.stringify([this.catalog.data.version, this.user.revision, parsed]);
    const cached = this.cache.get(key); if (cached) return structuredClone(cached);
    const result = this.resolveUncached(parsed);
    if (this.cache.size >= 500) this.cache.clear();
    this.cache.set(key, structuredClone(result)); return structuredClone(result);
  }

  private resolveUncached(parsed: ParsedItem): Resolution {
    const result: Resolution = { parsed, canonicalFoodId: null, canonicalName: null, status: "clarification", confidence: "unknown",
      method: "unknown", candidates: [], portion: null, nutrition: null, per100: null, source: null, warnings: [], recipe: null };
    if (parsed.error) return { ...result, warnings: [parsed.error] };
    const phrase = normalize(parsed.food);
    const mapping = this.user.mappings.find((m) => m.phrase === parsed.normalizedText) ??
      this.user.mappings.find((m) => m.phrase === phrase);
    const ownerIdentity = (this.catalog.exact.get(phrase) ?? []).some((match) => this.catalog.foods.get(match.foodId)?.source === "user");
    result.candidates = this.catalog.search(phrase);
    if (parsed.price && !mapping && !ownerIdentity) return { ...result, warnings: ["Price does not identify package weight. Select a product and portion; optionally remember this phrase."] };
    if (/^(?:snacks?|food|meal|something)$/.test(phrase) && !mapping && !ownerIdentity)
      return { ...result, warnings: ["Unable to identify specific food. Search the local catalog or create a custom food."] };
    let food: Food | undefined;
    if (mapping) { food = this.catalog.foods.get(mapping.foodId); result.method = "user_correction"; result.confidence = "exact"; }
    else {
      const exact = this.catalog.exact.get(phrase) ?? [];
      const filtered = exact.filter((match) => {
        const entry = this.catalog.foods.get(match.foodId)!;
        return parsed.variant ? entry.variant === parsed.variant : !entry.variant;
      }).sort((a, b) => b.priority - a.priority || a.foodId.localeCompare(b.foodId));
      const best = filtered[0];
      if (best && !filtered.some((m) => m.foodId !== best.foodId && m.priority === best.priority)) {
        food = this.catalog.foods.get(best.foodId); result.method = best.method;
        result.confidence = best.method === "barcode" || food?.foodType === "USER_CUSTOM" ? "exact" : "high";
      } else if (!exact.length) {
        const candidates = result.candidates;
        const best = candidates[0], second = candidates[1];
        if (best && best.score >= .91 && (!second || best.score - second.score >= .12)) {
          const candidate = this.catalog.foods.get(best.foodId)!;
          // Never autocorrect a branded/restaurant request to a generic food.
          if (!candidate.restaurant && !candidate.brand && !parsed.variant) {
            food = candidate; result.method = "fuzzy"; result.confidence = "medium";
            result.warnings.push(`Spelling matched to ${food.canonicalName}; confirm identity.`);
          }
        }
        if (!food && parsed.modifiers.length) {
          const base = parsed.modifiers.reduce((name, modifier) => name.replace(modifier, ""), phrase).replace(/\s+/g, " ").trim();
          const matches = this.catalog.exact.get(base) ?? [];
          if (new Set(matches.map((m) => m.foodId)).size === 1 && !parsed.variant) {
            food = this.catalog.foods.get(matches[0].foodId); result.method = "unmodeled_modifier"; result.confidence = "low";
            result.warnings.push(`No defined adjustment for ${parsed.modifiers.join(", ")}; base recipe shown, review before saving.`);
          }
        }
      }
    }
    if (!food) return { ...result, warnings: [...result.warnings, "Food or variant not uniquely identified. Choose a local candidate or create a custom food."] };
    result.canonicalFoodId = food.id; result.canonicalName = food.canonicalName;
    const source = this.catalog.sources.get(food.source);
    result.source = { dataset: source?.name ?? "Your saved food", id: food.sourceId, version: source?.version ?? String(this.user.revision), license: source?.license ?? "Private user data" };
    result.recipe = this.catalog.recipes.get(food.id) ?? null;
    result.per100 = this.catalog.nutrition(food.id);
    if (food.note) result.warnings.push(food.note);
    if (result.recipe) { result.warnings.push(result.recipe.note); if (result.confidence !== "exact") result.confidence = "low"; }
    const explicitBasis = parsed.unit === "g" || parsed.unit === "kg" ? "g" : parsed.unit === "ml" || parsed.unit === "l" ? "ml" : null;
    let amount: number | null = null;
    if (mapping?.amount !== null && mapping?.amount !== undefined &&
        (mapping.phrase === parsed.normalizedText || (!explicitBasis && mapping.unit === parsed.unit))) {
      amount = convertAmount(food, mapping.amount * (mapping.phrase === parsed.normalizedText ? 1 : parsed.quantity), mapping.basis);
      result.portion = amount === null ? null : { amount, basis: food.basis, source: "Your saved correction", description: "Explicit remembered portion" };
    } else if (explicitBasis) {
      amount = convertAmount(food, parsed.quantity * (["kg", "l"].includes(parsed.unit!) ? 1000 : 1), explicitBasis);
      result.portion = amount === null ? null : { amount, basis: food.basis, source: "User quantity", description: `${parsed.quantity} ${parsed.unit}${food.density && explicitBasis !== food.basis ? `; ${food.density.source}` : ""}` };
    } else {
      const choices = this.catalog.portions.get(food.id) ?? [];
      const unit = parsed.unit ?? (food.defaultPortion ? choices.find((p) => p.id === food!.defaultPortion)?.unit : null);
      const portion = choices.find((p) => p.unit === unit && p.size === parsed.size) ??
        (parsed.size === "medium" ? choices.find((p) => p.unit === unit && p.size === null) : undefined);
      if (portion) {
        amount = convertAmount(food, portion.amount * parsed.quantity, portion.basis);
        result.portion = amount === null ? null : { amount, basis: food.basis, source: portion.source, description: portion.description };
        if (portion.confidence !== "exact") {
          result.warnings.push(`Assumed ${parsed.quantity} × ${portion.amount} ${portion.basis} ${portion.description}; confirm serving.`);
          if (result.confidence === "high") result.confidence = "medium";
        }
      }
    }
    if (!result.per100) return { ...result, confidence: "unknown", warnings: [...result.warnings, "Local nutrition is missing or failed validation. Enter label values; no estimate was invented."] };
    if (!amount || !Number.isFinite(amount) || amount > 10000) return { ...result, confidence: "unknown",
      warnings: [...result.warnings, "Portion is not defined for this food. Enter grams/ml in the supported basis or teach a serving; no universal bowl/plate weight is assumed."] };
    result.nutrition = scaleNutrition(result.per100, amount); result.status = "resolved";
    return result;
  }
}
