"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCalories } from "@/lib/formatCalories";
import { createNutritionEngine } from "@/lib/nutrition/runtime";
import { rememberMapping } from "@/lib/nutrition/user-library";
import { type Basis, type Estimate, type Resolution, type UserData } from "@/lib/nutrition/types";
import { useSessionState } from "@/lib/useSessionState";
import { useLocalLibrary } from "./library/useLocalLibrary";
import styles from "./MealDashboard.module.css";

type Props = { description: string; onEstimate: (result: Estimate) => void; beforeEstimate?: () => boolean;
  sessionKey: string; returnTo?: "/" | "/nutrition"; beforeNavigate?: () => boolean;
  minimal?: boolean; hideAction?: boolean; secondaryAction?: boolean; onEstimating?: (busy: boolean) => void };
type EstimatorDraft = { temporary: UserData["mappings"]; result: Estimate | null };
const initialDraft: EstimatorDraft = { temporary: [], result: null };
const isDraft = (value: unknown): value is EstimatorDraft => !!value && typeof value === "object" &&
  "temporary" in value && Array.isArray(value.temporary) && "result" in value &&
  (value.result === null || typeof value.result === "object" && "items" in value.result && Array.isArray(value.result.items));

function CandidateEditor({ item, engine, onChoose, compact = false }: { item: Resolution; engine: ReturnType<typeof createNutritionEngine>; compact?: boolean;
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
    <p>{item.canonicalName ?? "Food not recognized"}{!compact && ` · Confidence: ${item.confidence}`}</p>
    <details open={!compact}><summary>Source &amp; assumptions</summary>
      {item.source && <p>Source: {item.source.dataset} · {item.source.version}</p>}
      {item.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
    </details>
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
    {!choices.length && <p>No reliable local candidate. Add a custom food in My foods &amp; recipes.</p>}
  </details>;
}

export default function LocalEstimator({ description, onEstimate, beforeEstimate, sessionKey, returnTo = "/", beforeNavigate,
  minimal = false, hideAction = false, secondaryAction = false, onEstimating }: Props) {
  const { user, ready, error: libraryError, update } = useLocalLibrary();
  const session = useSessionState(`mealio-estimator:${sessionKey}`, initialDraft, isDraft);
  const { temporary, result } = session.value;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [estimating, setEstimating] = useState(false);
  const pending = useRef(false), frame = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const combined = useMemo(() => ({ ...user, mappings: [...user.mappings.filter((m) => !temporary.some((t) => t.phrase === m.phrase)), ...temporary] }), [user, temporary]);
  const engine = useMemo(() => createNutritionEngine(combined), [combined]);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); if (timer.current !== null) clearTimeout(timer.current); }, []);
  function run(next = engine) {
    if (pending.current) return;
    if (beforeEstimate && !beforeEstimate()) return;
    pending.current = true; setEstimating(true); onEstimating?.(true); setError("");
    // Give the pending button one paint; the existing synchronous engine remains local.
    frame.current = requestAnimationFrame(() => {
      timer.current = setTimeout(() => {
        try { const estimate = next.estimate(description); session.setValue((current) => ({ ...current, result: estimate })); onEstimate(estimate); }
        catch (cause) { setError(minimal ? "Couldn’t estimate this meal. Try adding portions or enter nutrition manually." : cause instanceof Error ? cause.message : "Could not parse meal"); }
        finally { pending.current = false; setEstimating(false); onEstimating?.(false); }
      }, 0);
    });
  }
  const candidates = result && result.rawText === description && <div>{result.items.map((item, index) => <CandidateEditor key={`${result.rawText}-${index}`} item={item} engine={engine} compact={minimal}
      onChoose={(foodId, amount, basis, remember) => {
        if (beforeEstimate && !beforeEstimate()) return;
        try {
          const next = rememberMapping(combined, item.parsed.normalizedText, foodId, amount, basis, item.parsed.unit);
          if (remember) {
            const persisted = update((current) => rememberMapping(current, item.parsed.normalizedText, foodId, amount, basis, item.parsed.unit));
            next.revision = persisted.revision;
            setNotice("Interpretation remembered on this device.");
          }
          const estimate = createNutritionEngine(next).estimate(description);
          session.setValue((current) => ({ temporary: [...current.temporary.filter((m) => m.phrase !== item.parsed.normalizedText),
            ...(remember ? [] : next.mappings.filter((m) => m.phrase === item.parsed.normalizedText))], result: estimate }));
          setError(""); onEstimate(estimate);
        } catch (cause) { setError(minimal ? "Couldn’t use that portion. Check the food and amount, then try again." : cause instanceof Error ? cause.message : "Could not apply correction"); }
      }} />)}</div>;
  const libraryLink = <a className={minimal ? styles.quietLibraryLink : styles.libraryLink} href="/foods" onClick={(event) => {
      if (!session.persist() || (beforeNavigate && !beforeNavigate())) { event.preventDefault(); setError("Your browser could not preserve this draft. Keep this page open and allow session storage before opening the library."); return; }
      sessionStorage.setItem("mealio-library-return", returnTo);
    }}>{minimal ? <>My foods &amp; recipes <span aria-hidden="true">›</span></> : <><span><strong>My foods &amp; recipes</strong><small>Custom foods and saved recipes</small></span><span aria-hidden="true">›</span></>}</a>;
  const incomplete = result?.rawText === description && result.incomplete;
  return <div className={styles.localEstimator}>
    {!hideAction && <button type="button" className={secondaryAction ? styles.estimateAgain : styles.primary} aria-busy={estimating} disabled={!ready || !session.ready || estimating || (!minimal && !description.trim())} onClick={() => run()}>
      {estimating && <span className={styles.spinner} aria-hidden="true" />}{estimating ? "Estimating…" : minimal ? "Estimate" : "Estimate locally"}
    </button>}
    {minimal ? <div className={styles.estimatorMeta}><span className={styles.offlineIndicator} title="Food text stays on this device during estimation."><span aria-hidden="true">●</span> Offline</span>{libraryLink}</div> : <p>Food text stays on this device during estimation.</p>}
    {(error || libraryError || minimal && incomplete) && <div role="alert" className={minimal ? styles.entryError : styles.error}>
      <p>{error || (libraryError ? minimal ? "Your saved foods aren’t available. Open My foods & recipes to manage them." : libraryError : "Couldn’t estimate the whole meal. Add portions or enter nutrition manually.")}</p>
      {minimal && <div className={styles.errorActions}><button type="button" className={styles.textButton} disabled={estimating} onClick={() => run()}>Try again</button></div>}
    </div>}
    {notice && <p role="status">{notice}</p>}
    {minimal ? candidates && <details className={styles.foodDisclosure}><summary>Choose foods &amp; portions</summary>{candidates}</details> : candidates}
    {!minimal && libraryLink}
  </div>;
}
