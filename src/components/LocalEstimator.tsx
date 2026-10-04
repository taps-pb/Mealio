"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { formatCalories } from "@/lib/formatCalories";
import { createNutritionEngine, foodCatalog } from "@/lib/nutrition/runtime";
import { customFood, customRecipe, rememberMapping, removeCustomFood, UserLibrary } from "@/lib/nutrition/user-library";
import { emptyUserData, type Basis, type Estimate, type Resolution, type UserData } from "@/lib/nutrition/types";
import type { MealItemSnapshot } from "@/server/db/schema";
import styles from "./MealDashboard.module.css";

type Props = { description: string; onEstimate: (result: Estimate) => void; beforeEstimate?: () => boolean; existingSnapshots?: MealItemSnapshot[] };
function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "Mealio-local-foods.json"; link.click(); URL.revokeObjectURL(url);
}

function CandidateEditor({ item, engine, onChoose }: { item: Resolution; engine: ReturnType<typeof createNutritionEngine>;
  onChoose: (foodId: string, amount: number | null, basis: Basis, remember: boolean) => void }) {
  const [query, setQuery] = useState(item.parsed.food);
  const foodSelectId = useId();
  const [foodId, setFoodId] = useState(item.canonicalFoodId ?? "");
  const [amount, setAmount] = useState("");
  const [remember, setRemember] = useState(false);
  const choices = engine.catalog.search(query);
  const selected = engine.catalog.foods.get(foodId);
  return <details open={item.status === "clarification"} className={styles.item}>
    <summary>{item.parsed.rawText} · {item.nutrition ? `${formatCalories(item.nutrition.kcal)} kcal` : "Needs clarification"}</summary>
    <p>{item.canonicalName ?? "Food not recognized"} · Confidence: {item.confidence}</p>
    {item.source && <p>Source: {item.source.dataset} · {item.source.version}</p>}
    {item.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
    {item.recipe && <details><summary>Defined recipe ingredients</summary><ul>{item.recipe.ingredients.map((ingredient, i) =>
      <li key={i}>{engine.catalog.foods.get(ingredient.foodId)?.canonicalName}: {ingredient.amount} {ingredient.basis} · {ingredient.preparation}</li>)}</ul>
      <p>Cooked yield: {item.recipe.yieldGrams} g · Recipe version {item.recipe.version}</p></details>}
    <label>Search local foods<input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} /></label>
    <label htmlFor={foodSelectId}>Food or product</label><select id={foodSelectId} value={foodId} onChange={(event) => { setFoodId(event.target.value); setAmount(""); }}>
      <option value="">Choose a local food</option>
      {selected && !choices.some((c) => c.foodId === selected.id) && <option value={selected.id}>{selected.canonicalName}</option>}
      {choices.map((candidate) => <option key={candidate.foodId} value={candidate.foodId}>{candidate.name}</option>)}
    </select>
    {selected && <><label>Total consumed ({selected.basis === "serving" ? "defined units" : selected.basis})<input type="number" min="0.01" max="10000" step="any" value={amount} placeholder="Enter total amount, or use the food's defined portion" onChange={(event) => setAmount(event.target.value)} /></label>
      <label className={styles.localCheck}><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Always treat “{item.parsed.rawText}” this way</label>
      <button type="button" className={styles.secondary} disabled={!!amount && (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > 10000)}
        onClick={() => onChoose(foodId, amount ? Number(amount) : null, selected.basis, remember)}>Use this interpretation</button></>}
    {!choices.length && <p>No reliable local candidate. Create a custom food below.</p>}
  </details>;
}

export default function LocalEstimator({ description, onEstimate, beforeEstimate, existingSnapshots = [] }: Props) {
  const unitId = useId(), ingredientsId = useId();
  const [user, setUser] = useState<UserData>(emptyUserData);
  const [temporary, setTemporary] = useState<UserData["mappings"]>([]);
  const [result, setResult] = useState<Estimate | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [name, setName] = useState(""), [aliases, setAliases] = useState("");
  const [quantity, setQuantity] = useState("1"), [unit, setUnit] = useState("piece");
  const [kcal, setKcal] = useState(""), [protein, setProtein] = useState(""), [carbs, setCarbs] = useState(""), [fat, setFat] = useState("");
  const [ingredients, setIngredients] = useState(""), [yieldGrams, setYieldGrams] = useState(""), [servings, setServings] = useState("1");
  const library = () => new UserLibrary(window.localStorage, "owner", foodCatalog);
  const combined = useMemo(() => ({ ...user, mappings: [...user.mappings.filter((m) => !temporary.some((t) => t.phrase === m.phrase)), ...temporary] }), [user, temporary]);
  const engine = useMemo(() => createNutritionEngine(combined), [combined]);

  useEffect(() => {
    const load = () => { try { setUser(new UserLibrary(window.localStorage, "owner", foodCatalog).load()); setReady(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load local foods"); } };
    const frame = requestAnimationFrame(load);
    window.addEventListener("storage", load);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", load); };
  }, []);

  function run(next = engine) {
    if (beforeEstimate && !beforeEstimate()) return;
    try { const estimate = next.estimate(description); setResult(estimate); onEstimate(estimate); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not parse meal"); }
  }
  function save(next: UserData) { const saved = library().save(next); setUser(saved); setError(""); setNotice("Saved on this device. Estimate again to use updated foods."); return saved; }
  function create(recipe: boolean) {
    try {
      const current = library().load();
      if (recipe) {
        const estimates = engine.estimate(ingredients);
        if (estimates.incomplete) throw new Error("Resolve every ingredient and its portion first. Use exact food names and grams/ml where possible.");
        const next = customRecipe(current, { name, aliases: aliases.split(","), yieldGrams: Number(yieldGrams), servings: Number(servings), unit,
          ingredients: estimates.items.map((item) => ({ foodId: item.canonicalFoodId!, amount: item.portion!.amount, basis: item.portion!.basis, preparation: item.parsed.rawText })) });
        save(next);
      } else {
        if ([kcal, protein, carbs, fat].some((value) => !value.trim())) throw new Error("Enter all four nutrient values for the stated serving.");
        save(customFood(current, { name, aliases: aliases.split(","), servingAmount: Number(quantity), unit,
          nutrition: { kcal: Number(kcal), protein: Number(protein), carbs: Number(carbs), fat: Number(fat), fiber: null, sugar: null, sodium: null } }));
      }
      setName(""); setAliases("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save local food"); }
  }

  function migrateCorrections() {
    try {
      let next = library().load(), count = 0;
      for (const item of existingSnapshots) {
        if ((!item.portionEdited && item.source !== "manual") || item.kcal === null || item.protein === null || item.carbs === null || item.fat == null) continue;
        if (next.foods.some((f) => f.canonicalName === item.name)) continue;
        next = customFood(next, { name: item.name, aliases: [], servingAmount: item.grams ?? item.quantity ?? 1,
          unit: item.grams ? "g" : item.unit ?? "serving", nutrition: { kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat, fiber: item.fiber ?? null, sugar: item.sugar ?? null, sodium: null } });
        const foodId = next.foods.at(-1)!.id;
        if (item.grams && item.quantity) next = rememberMapping(next, item.name, foodId, item.grams / item.quantity, "g", item.unit);
        next.revision++; count++;
      }
      save(next); setNotice(`Imported ${count} reviewed food corrections from already loaded history.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import corrections"); }
  }
  return <div className={styles.localEstimator}>
    <button type="button" className={styles.secondary} disabled={!ready || !description.trim()} onClick={() => run()}>Estimate locally (offline)</button>
    <p>Food text stays on this device during estimation. Database {foodCatalog.version}.</p>
    <p><Link href="/nutrition" prefetch={false}>Open and prepare the standalone offline estimator</Link></p>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
    {result && result.rawText === description && <div>{result.items.map((item, index) => <CandidateEditor key={`${result.rawText}-${index}`} item={item} engine={engine}
      onChoose={(foodId, amount, basis, remember) => {
        if (beforeEstimate && !beforeEstimate()) return;
        try {
          const next = rememberMapping(combined, item.parsed.normalizedText, foodId, amount, basis, item.parsed.unit);
          if (remember) {
            const persisted = save(rememberMapping(library().load(), item.parsed.normalizedText, foodId, amount, basis, item.parsed.unit));
            next.revision = persisted.revision;
          }
          setTemporary((current) => [...current.filter((m) => m.phrase !== item.parsed.normalizedText),
            ...(remember ? [] : next.mappings.filter((m) => m.phrase === item.parsed.normalizedText))]);
          const estimate = createNutritionEngine(next).estimate(description); setResult(estimate); onEstimate(estimate);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not apply correction"); }
      }} />)}</div>}
    <details className={styles.item}><summary>My local foods &amp; recipes</summary>
      <p>Saved in this browser, including after restart. Export a backup to move devices; clearing browser data removes the library.</p>
      <label>Name<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>
      <label>Aliases, separated by commas<input value={aliases} maxLength={500} onChange={(event) => setAliases(event.target.value)} /></label>
      <label htmlFor={unitId}>Serving unit</label><select id={unitId} value={unit} onChange={(event) => setUnit(event.target.value)}>{["piece", "g", "ml", "slice", "bowl", "plate", "glass", "cup", "spoon", "teaspoon", "tablespoon", "packet", "bag", "can", "serving"].map((value) => <option key={value}>{value}</option>)}</select>
      <details open><summary>Custom food — nutrition for this serving</summary>
        <label>Serving amount<input type="number" min="0.01" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <div className={styles.fields}>{([["Calories", kcal, setKcal], ["Protein (g)", protein, setProtein], ["Carbs (g)", carbs, setCarbs], ["Fat (g)", fat, setFat]] as const).map(([label, value, setter]) =>
          <label key={label}>{label}<input type="number" min="0" step="any" value={value} onChange={(event) => setter(event.target.value)} /></label>)}</div>
        <button type="button" className={styles.secondary} disabled={!ready} onClick={() => create(false)}>Save custom food</button>
      </details>
      <details><summary>Custom recipe — calculate from local ingredients</summary>
        <label htmlFor={ingredientsId}>Ingredients (one per line)</label><textarea id={ingredientsId} value={ingredients} maxLength={500} rows={5} placeholder={"100 g paneer\n60 g tomato\n5 g oil"} onChange={(event) => setIngredients(event.target.value)} />
        <div className={styles.fields}><label>Cooked yield (g)<input type="number" min="1" step="any" value={yieldGrams} onChange={(event) => setYieldGrams(event.target.value)} /></label><label>Servings in yield<input type="number" min="0.01" step="any" value={servings} onChange={(event) => setServings(event.target.value)} /></label></div>
        <button type="button" className={styles.secondary} disabled={!ready || ["g", "ml"].includes(unit)} onClick={() => create(true)}>Save custom recipe</button><p>For recipes choose a household serving unit; ingredients and cooked yield determine the grams.</p>
      </details>
      {user.foods.map((food) => <p key={food.id}>{food.canonicalName} <button type="button" className={styles.secondary} onClick={() => {
        try { save(removeCustomFood(library().load(), food.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to remove"); }
      }}>Remove food</button></p>)}
      {user.mappings.map((mapping) => <p key={mapping.phrase}>{mapping.phrase} → {engine.catalog.foods.get(mapping.foodId)?.canonicalName} <button type="button" className={styles.secondary} onClick={() => {
        try { const next = library().load(); next.mappings = next.mappings.filter((m) => m.phrase !== mapping.phrase); save(next); setTemporary((current) => current.filter((m) => m.phrase !== mapping.phrase)); }
        catch { setError("Could not remove mapping"); }
      }}>Forget mapping</button></p>)}
      {!!existingSnapshots.length && <button type="button" className={styles.secondary} onClick={migrateCorrections}>Import saved meal corrections</button>}
      <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { try { download(library().export()); } catch { setError("Could not export library"); } }}>Export library</button>
        <button type="button" className={styles.secondary} onClick={() => { if (window.confirm("Remove all local foods, recipes and learned mappings from this device?")) { library().reset(); setUser(emptyUserData()); setTemporary([]); setResult(null); setReady(true); setError(""); } }}>Reset local library</button></div>
      <label>Import library backup (replaces local library)<input type="file" accept="application/json,.json" onChange={async (event) => {
        const file = event.target.files?.[0]; if (!file || !window.confirm("Replace this device's food library with the backup?")) return;
        try { setUser(library().import(await file.text())); setTemporary([]); setNotice("Library imported."); } catch { setError("Invalid backup or local storage unavailable; existing library retained."); }
      }} /></label>
    </details>
    <details><summary>Data sources &amp; licenses</summary><p>Contains data from <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts</a>, available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database License</a>; contents DbCL. USDA: CC0. Mealio recipe definitions: CC0. Subway: cited official nutrition facts.</p>
      <p><a href="/nutrition/openfoodfacts.json" download>Download adapted product database</a> · <a href="/nutrition/catalog.json" download>Full local database</a> · <a href="/nutrition/manifest.json" download>Source manifest</a></p></details>
  </div>;
}
