"use client";

import { useId, useMemo, useState } from "react";
import { createNutritionEngine } from "@/lib/nutrition/runtime";
import { customRecipe } from "@/lib/nutrition/user-library";
import { useSessionState } from "@/lib/useSessionState";
import { useLocalLibrary } from "./useLocalLibrary";
import { servingUnits } from "./FoodForm";
import LibraryShell from "./LibraryShell";
import NutritionSummary from "./NutritionSummary";
import styles from "./Library.module.css";

const initial = { name: "", aliases: "", ingredient: "", lines: [] as string[], yieldGrams: "", servings: "1", unit: "serving" };
const isDraft = (value: unknown): value is typeof initial => !!value && typeof value === "object" && "lines" in value && Array.isArray(value.lines) && value.lines.every((line) => typeof line === "string") &&
  ["name", "aliases", "ingredient", "yieldGrams", "servings", "unit"].every((key) => key in value && typeof (value as Record<string, unknown>)[key] === "string");

export default function RecipeForm() {
  const unitId = useId(), yieldId = useId();
  const { user, ready, error: loadError, update } = useLocalLibrary();
  const draft = useSessionState("mealio-new-recipe", initial, isDraft);
  const form = draft.value;
  const [error, setError] = useState("");
  const engine = useMemo(() => createNutritionEngine(user), [user]);
  const estimate = useMemo(() => {
    if (!ready || !form.lines.length) return null;
    try { return engine.estimate(form.lines.join("\n")); } catch { return null; }
  }, [engine, ready, form.lines]);
  const set = (key: Exclude<keyof typeof initial, "lines">, value: string) => draft.setValue((current) => ({ ...current, [key]: value }));
  function addIngredient() {
    try {
      const line = form.ingredient.trim();
      const result = engine.estimate(line);
      if (result.items.length !== 1) throw new Error("Add one ingredient at a time, including its amount.");
      if (result.incomplete) throw new Error("This ingredient needs a known food and portion. Try an exact local name with grams or ml, or save it as a custom food first.");
      engine.estimate([...form.lines, line].join("\n")); // Preserve the existing parser's size/count limits.
      draft.setValue((current) => ({ ...current, lines: [...current.lines, line], ingredient: "" })); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resolve this ingredient."); }
  }
  return <LibraryShell title="Create recipe" subtitle="Build a reusable recipe from local ingredients." back="/foods?tab=recipes">
    {(error || loadError) && <p role="alert" className={styles.error}>{error || loadError}</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        if (form.ingredient.trim()) throw new Error("Add the ingredient you typed before saving the recipe.");
        update((current) => {
          const resolved = createNutritionEngine(current).estimate(form.lines.join("\n"));
          if (resolved.incomplete) throw new Error("Resolve every ingredient and portion before saving.");
          return customRecipe(current, { name: form.name, aliases: form.aliases.split(","), yieldGrams: Number(form.yieldGrams), servings: Number(form.servings), unit: form.unit,
            ingredients: resolved.items.map((item) => ({ foodId: item.canonicalFoodId!, amount: item.portion!.amount, basis: item.portion!.basis, preparation: item.parsed.rawText })) });
        });
        draft.clear(); window.location.replace("/foods?tab=recipes&saved=1");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this recipe."); }
    }}><fieldset className={styles.form} disabled={!ready || !draft.ready}>
      <section className={styles.section} aria-label="Recipe details"><label className={styles.field}>Recipe name<input required maxLength={180} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. My paneer curry" /></label>
        <label className={styles.field}>Other names <small>Optional · separate with commas</small><input maxLength={500} value={form.aliases} onChange={(event) => set("aliases", event.target.value)} /></label></section>
      <section className={styles.section} aria-labelledby="ingredient-title"><h2 className={styles.sectionTitle} id="ingredient-title">Ingredients</h2>
        {!form.lines.length && <p className={styles.hint}>Start with a food and its amount. Each ingredient is resolved on this device.</p>}
        <ul className={styles.list} aria-label="Recipe ingredients">{form.lines.map((line, index) => {
          const item = estimate?.items[index];
          return <li className={styles.row} key={`${index}-${line}`}><div><strong>{item?.canonicalName ?? line}</strong><small>{line}{item?.status === "clarification" ? " · Needs clarification" : ""}</small></div>
            <button className={styles.iconButton} type="button" aria-label={`Delete ingredient ${index + 1}: ${line}`} onClick={() => draft.setValue((current) => ({ ...current, lines: current.lines.filter((_, number) => number !== index) }))}>×</button></li>;
        })}</ul>
        <div className={styles.ingredientEntry}><label className={styles.field}>Ingredient<input value={form.ingredient} maxLength={500} onChange={(event) => set("ingredient", event.target.value)} placeholder="e.g. 100 g paneer" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addIngredient(); } }} /></label>
          <p className={styles.hint}>Try 100 g paneer, 60 g tomato or 5 g oil.</p><button className={styles.button} type="button" disabled={!ready || !form.ingredient.trim()} onClick={addIngredient}>+ Add ingredient</button></div>
      </section>
      <section className={styles.section} aria-labelledby="yield-title"><h2 className={styles.sectionTitle} id="yield-title">Yield &amp; servings</h2>
        <div className={styles.field}><label htmlFor={yieldId}>Cooked yield (g)</label><input id={yieldId} aria-describedby={`${yieldId}-hint`} required type="number" inputMode="decimal" min="0.01" max="10000" step="any" value={form.yieldGrams} onChange={(event) => set("yieldGrams", event.target.value)} /><small id={`${yieldId}-hint`}>Required · the finished recipe’s weight, used to calculate nutrition by weight.</small></div>
        <label className={styles.field}>Servings<input required type="number" inputMode="decimal" min="0.01" max="10000" step="any" value={form.servings} onChange={(event) => set("servings", event.target.value)} /></label>
        <div className={styles.field}><label htmlFor={unitId}>Serving unit</label><select id={unitId} aria-describedby={`${unitId}-hint`} value={form.unit} onChange={(event) => set("unit", event.target.value)}>{servingUnits.map((unit) => <option key={unit}>{unit}</option>)}</select><small id={`${unitId}-hint`}>How you’ll log one portion, such as “1 bowl” or “1 serving”.</small></div>
      </section>
      {estimate?.totals && <NutritionSummary total={estimate.totals} servings={Number(form.servings)} />}
      {!!estimate?.items.some((item) => item.warnings.length) && <details><summary>Ingredient assumptions</summary>{estimate.items.map((item, index) => <p key={index} className={styles.hint}>{item.parsed.rawText}: {item.warnings.join(" ") || "Uses the specified portion."}</p>)}</details>}
      <div className={styles.saveBar}><button className={styles.primary} type="submit" disabled={!ready || !draft.ready || !estimate?.totals}>Save recipe</button></div>
    </fieldset></form>
  </LibraryShell>;
}
