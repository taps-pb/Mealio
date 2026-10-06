"use client";

import { useId, useState } from "react";
import { customFood } from "@/lib/nutrition/user-library";
import { useSessionState } from "@/lib/useSessionState";
import { useLocalLibrary } from "./useLocalLibrary";
import LibraryShell from "./LibraryShell";
import styles from "./Library.module.css";

export const servingUnits = ["piece", "slice", "bowl", "plate", "glass", "cup", "spoon", "teaspoon", "tablespoon", "packet", "bag", "can", "serving"];
const initial = { name: "", aliases: "", amount: "1", unit: "piece", kcal: "", protein: "", carbs: "", fat: "" };
const isDraft = (value: unknown): value is typeof initial => !!value && typeof value === "object" && Object.keys(initial).every((key) => key in value && typeof (value as Record<string, unknown>)[key] === "string");

export default function FoodForm() {
  const unitId = useId();
  const { ready, error: loadError, update } = useLocalLibrary();
  const draft = useSessionState("mealio-new-food", initial, isDraft);
  const [error, setError] = useState("");
  const form = draft.value;
  const set = (key: keyof typeof initial, value: string) => draft.setValue((current) => ({ ...current, [key]: value }));
  return <LibraryShell title="Add custom food" subtitle="Use the nutrition on your food’s label.">
    {(error || loadError) && <p role="alert" className={styles.error}>{error || loadError}</p>}
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        update((current) => customFood(current, { name: form.name, aliases: form.aliases.split(","), servingAmount: Number(form.amount), unit: form.unit,
          nutrition: { kcal: Number(form.kcal), protein: Number(form.protein), carbs: Number(form.carbs), fat: Number(form.fat), fiber: null, sugar: null, sodium: null } }));
        draft.clear(); window.location.replace("/foods?tab=foods&saved=1");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this food."); }
    }}><fieldset className={styles.form} disabled={!ready || !draft.ready}>
      <section className={styles.section} aria-label="Food details"><label className={styles.field}>Food name<input required maxLength={180} value={form.name} onChange={(event) => set("name", event.target.value)} autoComplete="off" placeholder="e.g. My paratha" /></label>
        <div className={styles.servingFields}><label className={styles.field}>Serving amount<input required type="number" inputMode="decimal" min="0.01" max="10000" step="any" value={form.amount} onChange={(event) => set("amount", event.target.value)} /></label>
          <div className={styles.field}><label htmlFor={unitId}>Serving unit</label><select id={unitId} value={form.unit} onChange={(event) => set("unit", event.target.value)}>{["g", "ml", ...servingUnits].map((unit) => <option key={unit}>{unit}</option>)}</select></div></div>
        <label className={styles.field}>Other names <small>Optional · separate with commas</small><input maxLength={500} value={form.aliases} onChange={(event) => set("aliases", event.target.value)} placeholder="e.g. homemade paratha" /></label>
      </section>
      <section className={styles.section} aria-labelledby="food-nutrition"><h2 className={styles.sectionTitle} id="food-nutrition">Nutrition per serving</h2><p className={styles.hint}>Values for {form.amount || "the amount"} {form.unit} entered above.</p>
        {([["kcal", "Calories (kcal)"], ["protein", "Protein (g)"], ["carbs", "Carbohydrates (g)"], ["fat", "Fat (g)"]] as const).map(([key, label]) => <label key={key} className={styles.field}>{label}<input required type="number" inputMode="decimal" min="0" max="100000000" step="any" value={form[key]} onChange={(event) => set(key, event.target.value)} /></label>)}
      </section>
      <div className={styles.saveBar}><button className={styles.primary} type="submit" disabled={!ready || !draft.ready}>Save food</button></div>
    </fieldset></form>
  </LibraryShell>;
}
