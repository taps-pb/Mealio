"use client";

import { useCallback, useEffect, useId, useRef, useState, type SetStateAction } from "react";
import { formatCalories } from "@/lib/formatCalories";
import type { MealItemSnapshot as Snapshot } from "@/server/db/schema";
import type { Estimate } from "@/lib/nutrition/types";
import { toSnapshots } from "@/lib/nutrition/snapshots";
import { useSessionState } from "@/lib/useSessionState";
import { snapshotSchema } from "@/server/meals/validation";
import ThemeToggle from "./ThemeToggle";
import LocalEstimator from "./LocalEstimator";
import HistoryPanel from "./HistoryPanel";
import MealRing from "./MealRing";
import { dayTitle, groupForDay, stepDayKey } from "./daySelection";
import { mealEntryTime } from "./mealEntryTime";
import styles from "./MealDashboard.module.css";

type Macro = { kcal: number; protein: number; carbs: number; fat?: number | null };
type Meal = Macro & { id: string; description: string; eatenAt: string; itemSnapshots: Snapshot[]; provenance: "manual" | "estimated" | "corrected" };
type DayGroup = { day: string; meals: Meal[]; totalKcal: number; totalProtein: number; totalCarbs: number };
type Draft = {
  id: string | null; key: string; description: string; eatenAt: string; originalEatenAt: string | null; timeChanged: boolean;
  kcal: string; protein: string; carbs: string; fat: string; items: Snapshot[]; provenance: Meal["provenance"];
};
type View = "today" | "history" | "entry" | "review" | "details";
type JournalSession = { draft: Draft | null; view: View };
const initialSession: JournalSession = { draft: null, view: "today" };
function isSession(value: unknown): value is JournalSession {
  if (!value || typeof value !== "object" || !("view" in value) || !("draft" in value) || !["today", "history", "entry", "review", "details"].includes(String(value.view))) return false;
  if (value.draft === null) return value.view !== "entry" && value.view !== "review";
  const draft = value.draft as Draft;
  return !!draft && typeof draft === "object" && ["key", "description", "eatenAt", "kcal", "protein", "carbs", "fat"].every((key) => typeof draft[key as keyof Draft] === "string") &&
    (draft.id === null || typeof draft.id === "string") && (draft.originalEatenAt === null || typeof draft.originalEatenAt === "string") && typeof draft.timeChanged === "boolean" &&
    ["manual", "estimated", "corrected"].includes(draft.provenance) && snapshotSchema.array().safeParse(draft.items).success;
}
const pad = (number: number) => String(number).padStart(2, "0");
const localInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const newDraft = (): Draft => ({ id: null, key: crypto.randomUUID(), description: "", eatenAt: localInput(new Date()), originalEatenAt: null,
  timeChanged: true, kcal: "", protein: "", carbs: "", fat: "", items: [], provenance: "manual" });
const round2 = (number: number) => Math.round(number * 100) / 100;
const sourceLabel = (source: Snapshot["source"]) => ({ usda: "USDA reference", indb: "INDB reference recipe",
  manual: "Your correction", unmatched: "No verified reference", recipe_estimate: "Ingredient-based recipe estimate",
  estimated: "Approximate food estimate", local: "Local nutrition database" })[source];
const SnapshotInfo = ({ item }: { item: Snapshot }) => <div className={styles.snapshotInfo}>
  <div className={styles.estimateHeading}><strong>{item.name}</strong><span className={styles.sourceBadge}>
    Confidence: {item.matchConfidence ? item.matchConfidence[0].toUpperCase() + item.matchConfidence.slice(1) : item.source === "manual" ? "Owner edited" : "Low"}
  </span></div>
  <p>{item.quantity ?? 1} {item.unit ?? "serving"}{item.grams !== null ? ` · ~${item.grams} g` : " · weight unknown"}</p>
  <strong className={styles.estimateLabel}>{item.source === "manual" ? "Your nutrition" : "Estimated nutrition"}</strong>
  <div className={styles.estimateMetrics}>
    {([ ["Calories", item.kcal, "kcal"], ["Protein", item.protein, "g"], ["Carbs", item.carbs, "g"], ["Fat", item.fat, "g"] ] as const)
      .map(([label, value, unit]) => <div key={label}><small>{label}</small><strong>{value == null ? "—" : `${item.source === "manual" ? "" : "~"}${unit === "kcal" ? formatCalories(value) : value} ${unit}`}</strong></div>)}
  </div>
  <p className={styles.estimateNote}>{item.source === "recipe_estimate" || item.source === "estimated"
    ? "Estimated from a typical serving or recipe. Actual ingredients, portion and cooking oil may vary."
    : item.source === "manual" ? "Your corrections are saved as entered."
    : item.source === "unmatched" ? "Nutrition is unavailable for this food; add details or enter it manually."
    : "Based on a food reference. Confirm the portion and preparation."}</p>
  {(item.uncertainty || item.assumptions?.length || item.ingredients?.length || item.sourceId) ?
    <details><summary>Review ingredient breakdown</summary>
      <p>{item.local?.source ?? sourceLabel(item.source)}{item.sourceId ? ` · Reference ${item.sourceId}` : ""}</p>
      {item.local && <p>Database {item.local.databaseVersion} · {item.local.method} · Original: {item.local.rawText}</p>}
      {item.uncertainty && <p className={styles.uncertain}>{item.uncertainty}</p>}
      {(item.assumptions ?? []).filter((note) => !item.uncertainty?.includes(note))
        .map((note, index) => <p key={index} className={styles.assumption}>Assumption: {note}</p>)}
      {!!item.ingredients?.length && <ul>{item.ingredients.map((entry, index) => <li key={index}>{entry.name} · {entry.grams} g · {entry.kcal == null ? "—" : formatCalories(entry.kcal)} kcal · {sourceLabel(entry.source)}{entry.uncertainty ? ` · ${entry.uncertainty}` : ""}</li>)}</ul>}
    </details> : null}
</div>;

export default function MealDashboard({ username, timezone, onLogout }: { username: string; timezone: string; onLogout: () => void }) {
  const descriptionId = useId(), nutritionId = useId(), timeId = useId();
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const journal = useSessionState("mealio-journal-draft", initialSession, isSession);
  const { view, draft } = journal.value;
  const setSession = journal.setValue;
  const setView = useCallback((view: View) => setSession((current) => ({ ...current, view })), [setSession]);
  const setDraft = useCallback((next: SetStateAction<Draft | null>) => setSession((current) => ({ ...current,
    draft: typeof next === "function" ? next(current.draft) : next })), [setSession]);
  const navigationApplied = useRef(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailsFrom, setDetailsFrom] = useState<"today" | "history">("today");
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [todayKey, setTodayKey] = useState("");
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [manualOpen, setManualOpen] = useState(false), [timeOpen, setTimeOpen] = useState(false);
  const [estimating, setEstimating] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/meals", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) { onLogout(); return; }
      if (!response.ok) throw new Error("meal list unavailable");
      const data: { todayKey: string; groups: DayGroup[] } = await response.json();
      setTodayKey(data.todayKey);
      setGroups(data.groups);
      try { sessionStorage.setItem("mealio-reviewed-snapshots", JSON.stringify(data.groups.flatMap((group) => group.meals.flatMap((meal) => meal.itemSnapshots)))); } catch { /* The journal still works when tab storage is unavailable. */ }
      setLoaded(true);
      setError("");
    } catch { setLoaded(true); setError("Could not load meals. Try again."); }
  }, [onLogout]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(frame);
  }, [load]);
  useEffect(() => {
    const refreshVisibleDay = () => {
      if (document.visibilityState === "visible" && view === "today") void load();
    };
    document.addEventListener("visibilitychange", refreshVisibleDay);
    return () => document.removeEventListener("visibilitychange", refreshVisibleDay);
  }, [load, view]);
  useEffect(() => {
    if (!journal.ready || navigationApplied.current) return;
    const frame = requestAnimationFrame(() => {
      navigationApplied.current = true;
      const screen = new URLSearchParams(location.search).get("screen");
      if (screen === "entry") setSession((current) => ({ view: "entry", draft: current.draft ?? newDraft() }));
      if (screen === "today" || screen === "history") setView(screen);
      if (screen) history.replaceState(history.state, "", location.pathname);
    });
    return () => cancelAnimationFrame(frame);
  }, [journal.ready, setSession, setView]);
  useEffect(() => {
    const input = descriptionRef.current;
    if (!input || view !== "entry") return;
    input.style.height = "auto";
    input.style.height = `${Math.min(196, Math.max(88, input.scrollHeight))}px`;
  }, [draft?.description, view]);

  const displayedDayKey = selectedDayKey ?? todayKey;
  const displayedDay = groupForDay(groups, displayedDayKey);
  const displayedTitle = dayTitle(displayedDayKey, todayKey);
  const changeView = (next: View) => {
    if (draft && !window.confirm("Discard your unsaved meal changes?")) return false;
    setDraft(null); setEstimating(false); setError(""); setView(next);
    return true;
  };
  const startNew = () => {
    if (draft && !window.confirm("Discard your unsaved meal changes?")) return;
    setDraft(newDraft());
    setManualOpen(false); setTimeOpen(false); setEstimating(false);
    setError(""); setView("entry");
  };
  const startEdit = (meal: Meal) => {
    setDraft({ id: meal.id, key: "", description: meal.description, eatenAt: localInput(new Date(meal.eatenAt)),
      originalEatenAt: meal.eatenAt, timeChanged: false, kcal: String(meal.kcal), protein: String(meal.protein),
      carbs: String(meal.carbs), fat: meal.fat == null ? "" : String(meal.fat),
      items: meal.itemSnapshots.map((item) => ({ ...item, portionEdited: false })), provenance: meal.provenance });
    setManualOpen(false); setTimeOpen(false); setEstimating(false); setError(""); setView("entry");
  };

  function applyEstimate(result: Estimate) {
      // The engine/snapshots retain precision. Meal totals remain compatible with
      // the existing reviewed NUMERIC(10,2) save fields.
      setDraft((current) => current ? {
        ...current, items: toSnapshots(result),
        // An explicit estimate must never silently replace manual corrections.
        kcal: current.provenance === "estimated" || !current.kcal ? result.totals ? String(round2(result.totals.kcal)) : "" : current.kcal,
        protein: current.provenance === "estimated" || !current.protein ? result.totals ? String(round2(result.totals.protein)) : "" : current.protein,
        carbs: current.provenance === "estimated" || !current.carbs ? result.totals ? String(round2(result.totals.carbs)) : "" : current.carbs,
        fat: current.provenance === "estimated" || !current.fat ? result.totals?.fat == null ? "" : String(round2(result.totals.fat)) : current.fat,
        provenance: current.provenance === "corrected" || (current.provenance === "manual" &&
          (current.kcal || current.protein || current.carbs || current.fat)) ? "corrected" : "estimated",
      } : null);
       setError("");
       if (!result.incomplete && result.totals) { setManualOpen(false); setTimeOpen(false); setView("review"); }
  }

  function updateItem(index: number, patch: Partial<Snapshot>) {
    setDraft((current) => current ? { ...current, provenance: "corrected",
      items: current.items.map((item, number) => {
        if (number !== index) return item;
        if ("grams" in patch) {
          const grams = patch.grams;
          if (grams !== null && grams !== undefined && item.per100g && item.source !== "manual") {
            const scale = (value: number | null) => value === null ? null : value * grams / 100;
            const note = "Weight corrected by you; source nutrition rescaled.";
            const remaining = item.uncertainty?.split("; ").filter((entry) => entry !== item.portionUncertainty) ?? [];
            return { ...item, ...patch, quantity: item.quantity ?? 1, portionEdited: true,
              ...(item.local ? { local: { ...item.local, portionAmount: grams, portionBasis: "g" as const, method: "user_portion_correction" } } : {}),
              kcal: scale(item.per100g.kcal), protein: scale(item.per100g.protein), carbs: scale(item.per100g.carbs),
              fat: scale(item.per100g.fat), fiber: scale(item.per100g.fiber), sugar: scale(item.per100g.sugar),
              portionUncertainty: note, uncertainty: [...remaining.filter((entry) => entry !== note), note].join("; ").slice(0, 500),
              assumptions: [...(item.assumptions ?? []).filter((entry) => entry !== item.portionUncertainty), note].slice(0, 12) };
          }
          if (grams !== null && grams !== undefined && grams > 0 && item.source === "recipe_estimate" &&
              item.grams !== null && item.grams > 0 && item.ingredients?.length) {
            const ratio = grams / item.grams;
            const ingredients = item.ingredients.map((entry) => ({ ...entry,
              grams: Math.max(.01, round2(entry.grams * ratio)),
              kcal: entry.kcal === null ? null : round2(entry.kcal * ratio),
              protein: entry.protein === null ? null : round2(entry.protein * ratio),
              carbs: entry.carbs === null ? null : round2(entry.carbs * ratio),
              fat: entry.fat === null ? null : round2(entry.fat * ratio),
            }));
            const scale = (value: number | null | undefined) => value == null ? null : round2(value * ratio);
            const note = "Recipe portion corrected by you; ingredient amounts and resolved nutrients rescaled. Confirm recipe assumptions.";
            return { ...item, ...patch, quantity: item.quantity ?? 1, ingredients, portionEdited: true,
              kcal: scale(item.kcal), protein: scale(item.protein), carbs: scale(item.carbs), fat: scale(item.fat),
              portionUncertainty: note, uncertainty: [item.recipeUncertainty, note].filter(Boolean).join("; ").slice(0, 500),
              assumptions: [...(item.assumptions ?? []).filter((entry) => entry !== item.portionUncertainty), note].slice(0, 12) };
          }
          return { ...item, ...patch, quantity: item.quantity ?? 1, portionEdited: grams !== null && grams !== undefined };
        }
        if ("name" in patch || "quantity" in patch || "unit" in patch || "kcal" in patch ||
            "protein" in patch || "carbs" in patch || "fat" in patch) {
          return { ...item, ...patch, source: "manual", sourceId: null, per100g: null,
            portionEdited: "name" in patch || "quantity" in patch || "unit" in patch ? false : item.portionEdited,
            uncertainty: "Manually corrected; source values will not overwrite your nutrients." };
        }
        return { ...item, ...patch };
      }) } : null);
  }
  function useItemSums() {
    if (!draft?.items.length || draft.items.some((item) => item.kcal === null || item.protein === null || item.carbs === null)) {
      setError("Fill each item's calories, protein, and carbs before using item sums."); return;
    }
    const sum = draft.items.reduce<Macro>((total, item) => ({
      kcal: total.kcal + (item.kcal ?? 0), protein: total.protein + (item.protein ?? 0), carbs: total.carbs + (item.carbs ?? 0),
    }), { kcal: 0, protein: 0, carbs: 0 });
    const fat = draft.items.every((item) => item.fat !== null && item.fat !== undefined) ?
      round2(draft.items.reduce((total, item) => total + (item.fat ?? 0), 0)) : null;
    setDraft({ ...draft, kcal: String(round2(sum.kcal)), protein: String(round2(sum.protein)), carbs: String(round2(sum.carbs)),
      fat: fat === null ? "" : String(fat), provenance: "corrected" });
    setError("");
  }

  function validated() {
    if (!draft?.description.trim() || draft.description.length > 500) { setError("Enter a meal description (up to 500 characters)."); return null; }
    if (draft.items.some((item) => {
      const portion = [item.quantity, item.grams];
      const nutrients = [item.kcal, item.protein, item.carbs];
      return !item.name.trim() || item.name.length > 200 ||
        portion.some((value) => value !== null && (!Number.isFinite(value) || value <= 0)) ||
        nutrients.some((value) => value !== null && (!Number.isFinite(value) || value < 0 ||
          value > 99_999_999.99));
    })) { setError("Check food names, positive portions, and item nutrients."); return null; }
    const numbers = [draft.kcal, draft.protein, draft.carbs].map(Number);
    if ([draft.kcal, draft.protein, draft.carbs].some((value) => value.trim() === "") ||
        numbers.some((value) => !Number.isFinite(value) || value < 0 || value > 99_999_999.99 || Math.abs(value * 100 - Math.round(value * 100)) > .00001)) {
      setError("Enter non-negative kcal, protein, and carbs with at most two decimals."); return null;
    }
    const instant = new Date(draft.eatenAt);
    if (!draft.eatenAt || !Number.isFinite(instant.getTime()) || localInput(instant) !== draft.eatenAt) {
      setError("Choose a valid date and time."); return null;
    }
    const fat = draft.fat.trim() === "" ? null : Number(draft.fat);
    if (fat !== null && (!Number.isFinite(fat) || fat < 0 || fat > 99_999_999.99 || Math.abs(fat * 100 - Math.round(fat * 100)) > .00001)) {
      setError("Enter non-negative fat with at most two decimals, or leave it unknown."); return null;
    }
    return { description: draft.description.trim(), eatenAt: draft.timeChanged ? instant.toISOString() : draft.originalEatenAt ?? instant.toISOString(),
      kcal: numbers[0], protein: numbers[1], carbs: numbers[2], fat, itemSnapshots: draft.items, provenance: draft.provenance };
  }

  async function save() {
    if (view !== "review" || !draft || busy) return;
    const input = validated(); if (!input) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(draft.id ? `/api/meals/${draft.id}` : "/api/meals", {
        method: draft.id ? "PUT" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.id ? input : { ...input, idempotencyKey: draft.key }),
      });
      if (response.status === 401) { onLogout(); return; }
      if (response.status === 409) { setError("This save key was used for a different meal. Reload history before retrying."); return; }
      if (!response.ok) { setError("Save failed. Your entry is still here; try again."); return; }
      try { sessionStorage.removeItem(`mealio-estimator:${draft.key || draft.id}`); } catch { /* Saved server data is unaffected. */ }
      setDraft(null); setView("today"); await load();
    } catch { setError("Save failed. Your entry is still here; try again."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/meals/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (response.status === 401) { onLogout(); return; }
      if (!response.ok) { setError("Delete failed. Please try again."); return; }
      setDeleteId(null); if (view === "details") setView(detailsFrom); await load();
    } catch { setError("Delete failed. Please try again."); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) { setError("Could not log out. Try again."); return; }
      journal.clear();
      try { sessionStorage.removeItem("mealio-reviewed-snapshots"); } catch { /* No history is stored in the local food library. */ }
      onLogout();
    } catch { setError("Could not log out. Try again."); }
    finally { setBusy(false); }
  }

  const detailMeal = groups.flatMap((group) => group.meals).find((meal) => meal.id === detailId);
  const mealEntry = view === "entry" || view === "review";
  const hasNutrition = !!draft && [draft.kcal, draft.protein, draft.carbs].every((value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);
  const canReview = hasNutrition && !!draft?.description.trim();
  const renderMeal = (meal: Meal) => <article key={meal.id} className={styles.meal}>
    <span className={styles.mealIcon} aria-hidden="true">✦</span>
    <div className={styles.mealCopy}><strong>{meal.description}</strong><small>{new Date(meal.eatenAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone })} · P {meal.protein}g · C {meal.carbs}g{meal.fat == null ? "" : ` · F ${meal.fat}g`}</small>{meal.itemSnapshots.some((item) => item.uncertainty) && <small>Contains uncertain items</small>}</div>
    <div className={styles.mealKcal}>{formatCalories(meal.kcal)}<small>kcal</small></div>
    <div className={styles.mealActions}><button type="button" onClick={() => { setDetailId(meal.id); setDetailsFrom(view === "history" ? "history" : "today"); setDeleteId(null); setView("details"); }}>Details</button><button type="button" onClick={() => startEdit(meal)}>Edit</button><button type="button" onClick={() => setDeleteId(meal.id)}>Delete</button></div>
    {deleteId === meal.id && <div className={styles.confirm}><span>Delete {meal.description}?</span><button type="button" disabled={busy} onClick={() => void remove(meal.id)}>Yes, delete</button><button type="button" onClick={() => setDeleteId(null)}>Cancel</button></div>}
  </article>;

  return <main className={`${styles.app} ${mealEntry ? styles.entryApp : ""}`}>
    <header className={`${styles.header} ${mealEntry ? styles.entryHeader : ""}`}><div>{!mealEntry && <span className={styles.eyebrow}>YOUR MEAL JOURNAL · {username}</span>}<h1>Mealio<span>.</span></h1></div><div className={styles.headerActions}><ThemeToggle />{!mealEntry && <button type="button" disabled={busy} onClick={() => void logout()}>Log out</button>}</div></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!loaded && !mealEntry && <p role="status">Loading meals…</p>}

    {view === "today" && loaded && <><section className={styles.hero}><div className={styles.heading}><div><span className={styles.eyebrow}>CALORIES BY MEAL</span><h2 aria-live="polite">{displayedTitle}</h2></div><span>{displayedDayKey} · {timezone}</span></div>
      {todayKey && <div className={styles.dayControls} role="group" aria-label="Choose day for calorie ring">
        <button type="button" aria-label="Previous day" onClick={() => setSelectedDayKey(stepDayKey(displayedDayKey, -1))}>‹</button>
        <label className={styles.dayDate}><span className={styles.visuallyHidden}>Show day in {timezone}</span>
          <input type="date" value={displayedDayKey} max={todayKey} onChange={(event) => {
            const value = event.target.value;
            if (value && value <= todayKey) setSelectedDayKey(value === todayKey ? null : value);
          }} />
        </label>
        <button type="button" aria-label="Next day" disabled={displayedDayKey >= todayKey} onClick={() => {
          const next = stepDayKey(displayedDayKey, 1);
          setSelectedDayKey(next >= todayKey ? null : next);
        }}>›</button>
        {displayedDayKey !== todayKey && <button type="button" className={styles.backToday} onClick={() => { setSelectedDayKey(null); void load(); }}>Today</button>}
      </div>}
      <MealRing meals={(displayedDay?.meals ?? []).map((meal) => ({ id: meal.id, name: meal.description, kcal: meal.kcal }))} />
      <div className={styles.macros}><div><span className={styles.macroIcon} aria-hidden="true">P</span><span><small>Protein</small><strong>{displayedDay?.totalProtein ?? 0} g</strong></span></div><div><span className={styles.macroIcon} aria-hidden="true">C</span><span><small>Carbs</small><strong>{displayedDay?.totalCarbs ?? 0} g</strong></span></div></div></section>
      <section className={styles.list}><div className={styles.heading}><h2>{displayedTitle === "Today" ? "Meals today" : displayedTitle === "Yesterday" ? "Meals yesterday" : "Meals on this day"}</h2><span>{displayedDay?.meals.length ?? 0} logged</span></div>
        {displayedDay?.meals.length ? displayedDay.meals.map(renderMeal) : <p className={styles.empty}>{displayedTitle === "Today" ? "No meals yet. Add one to start your day." : "No meals logged on this day. Choose another date or open History."}</p>}
      </section></>}
    {loaded && <div hidden={view !== "history"}><HistoryPanel groups={groups} timezone={timezone} onOpenDetails={(meal) => { setDetailId(meal.id); setDetailsFrom("history"); setDeleteId(null); setView("details"); }} /></div>}

    {view === "details" && loaded && <section className={styles.editor}>
      <span className={styles.eyebrow}>SAVED MEAL</span><h2>Meal details</h2>
      {detailMeal ? <>
        <p>{new Date(detailMeal.eatenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone })} · {timezone}</p>
        <h3>{detailMeal.description}</h3><div className={styles.macros}>
          <div><small>Calories</small><strong>{formatCalories(detailMeal.kcal)} kcal</strong></div>
          <div><small>Protein</small><strong>{detailMeal.protein} g</strong></div>
          <div><small>Carbs</small><strong>{detailMeal.carbs} g</strong></div>
          <div><small>Fat</small><strong>{detailMeal.fat == null ? "—" : `${detailMeal.fat} g`}</strong></div>
        </div><p>Saved nutrition snapshot · {detailMeal.provenance}. Re-estimation never changes saved values automatically.</p>
        {detailMeal.itemSnapshots.map((item, index) => <div className={styles.item} key={index}><SnapshotInfo item={item} /></div>)}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => startEdit(detailMeal)}>Edit meal</button><button type="button" className={styles.secondary} onClick={() => setDeleteId(detailMeal.id)}>Delete…</button></div>
        {deleteId === detailMeal.id && <div className={styles.confirm}><span>Delete {detailMeal.description}?</span><button type="button" disabled={busy} onClick={() => void remove(detailMeal.id)}>Yes, delete</button><button type="button" onClick={() => setDeleteId(null)}>Cancel</button></div>}
      </> : <p role="status">Meal not found. Return to history.</p>}
      <button type="button" className={styles.secondary} onClick={() => changeView(detailsFrom)}>Back to {detailsFrom === "today" ? "Today" : "History"}</button>
    </section>}

    {mealEntry && draft && <section className={`${styles.editor} ${styles.mealEntry}`} aria-label="Add meal">
      <h2>What did you eat?</h2>
      {/* Keep the estimator mounted while reviewing so temporary interpretations survive. */}
      <div hidden={view === "review"}>
        <label className={styles.visuallyHidden} htmlFor={descriptionId}>Meal description</label>
        <textarea ref={descriptionRef} id={descriptionId} className={styles.mealInput} rows={2} maxLength={500} disabled={estimating} placeholder="2 aloo parathas, curd and chai" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        <LocalEstimator key={draft.key || draft.id} sessionKey={draft.key || draft.id!} description={draft.description} onEstimate={applyEstimate} beforeNavigate={journal.persist}
          minimal hideAction={manualOpen} secondaryAction={canReview} onEstimating={setEstimating}
          beforeEstimate={() => {
            if (!draft.description.trim()) { descriptionRef.current?.focus(); return false; }
            return !draft.items.some((item) => item.source === "manual" || item.portionEdited) || window.confirm("Replace your corrected item estimates? Saved meals are unchanged until you save.");
          }} />
      </div>
      {view === "review" && <>
        <div className={styles.mealDescriptionRow}><p className={styles.mealDescription}>{draft.description}</p><button type="button" className={styles.textButton} onClick={() => { setManualOpen(false); setView("entry"); }}>Edit meal</button></div>
        <section className={styles.nutritionResult} aria-label="Meal nutrition summary" aria-live="polite">
          <span className={styles.resultCaption}>{draft.provenance === "estimated" ? "Estimated nutrition" : "Your nutrition"}</span>
          <div className={styles.resultCalories}><strong>{draft.kcal.trim() === "" ? "—" : formatCalories(draft.kcal)}</strong><span>kcal</span></div>
          <dl className={styles.resultMacros}>{([["protein", "Protein"], ["carbs", "Carbs"], ["fat", "Fat"]] as const).map(([field, label]) => <div key={field}>
            <dd>{draft[field].trim() === "" ? "—" : <>{formatCalories(draft[field])}<span> g</span></>}</dd><dt>{label}</dt>
          </div>)}</dl>
        </section>
      </>}
      <div className={view === "entry" ? styles.manualPrompt : styles.nutritionEdit}>
        {view === "entry" && !manualOpen && !hasNutrition && !draft.items.length && <span className={styles.or}>or</span>}
        <button type="button" className={styles.textButton} aria-expanded={manualOpen} aria-controls={nutritionId} onClick={() => setManualOpen((open) => !open)}>
          {manualOpen ? "Hide nutrition" : hasNutrition || view === "review" ? "Edit nutrition" : "Enter nutrition manually"}
        </button>
      </div>
      {manualOpen && <div id={nutritionId} className={`${styles.manualGrid} ${styles.reveal}`} role="group" aria-label="Manual meal nutrition">
        {([["kcal", "Calories", "Meal calories"], ["protein", "Protein (g)", "Meal protein (g)"], ["carbs", "Carbs (g)", "Meal carbs (g)"], ["fat", "Fat (g)", "Meal fat (g) · optional"]] as const).map(([field, label, accessible]) => <label key={field}>{label}<input aria-label={accessible} type="number" inputMode="decimal" min="0" step="0.01" placeholder={field === "fat" ? "Optional" : "0"} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value, provenance: "corrected" })} /></label>)}
      </div>}
      {!!draft.items.length && (view === "review" || hasNutrition) && <details className={styles.foodDisclosure}><summary>Food details &amp; corrections</summary><div className={styles.items}>{draft.items.map((item, index) => <fieldset key={index} className={styles.item}><legend>Food {index + 1}</legend><SnapshotInfo item={item} />
        <label>Food name<input value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} /></label><div className={styles.fields}><label>Quantity<input type="number" min="0.01" step="any" value={item.quantity ?? ""} onChange={(event) => updateItem(index, { quantity: event.target.value ? Number(event.target.value) : null })} /></label><label>Unit<input value={item.unit ?? ""} onChange={(event) => updateItem(index, { unit: event.target.value || null })} /></label><label>Grams<input type="number" min="0.01" step="any" value={item.grams ?? ""} onChange={(event) => updateItem(index, { grams: event.target.value ? Number(event.target.value) : null })} /></label></div>
        <div className={styles.fields}>{(["kcal", "protein", "carbs", "fat"] as const).map((field) => <label key={field}>{field === "kcal" ? "Calories" : `${field} (g)`}<input type="number" min="0" step="0.01" value={item[field] ?? ""} onChange={(event) => updateItem(index, { [field]: event.target.value === "" ? null : Number(event.target.value) })} /></label>)}</div>
      </fieldset>)}<button type="button" className={styles.secondary} onClick={useItemSums}>Use item sums for meal totals</button><p>Editing an item does not silently change the meal totals.</p></div></details>}
      <div className={styles.mealTime}>
        <button type="button" className={styles.timeRow} aria-label={`Change meal time: ${mealEntryTime(draft.eatenAt)}`} aria-expanded={timeOpen} aria-controls={timeId} onClick={() => setTimeOpen((open) => !open)}><span>{mealEntryTime(draft.eatenAt)}</span><span aria-hidden="true">{timeOpen ? "⌄" : "›"}</span></button>
        {timeOpen && <div className={styles.reveal} id={timeId}><label>Date &amp; time<input type="datetime-local" value={draft.eatenAt} onChange={(event) => setDraft({ ...draft, eatenAt: event.target.value, timeChanged: true })} /></label><button type="button" className={styles.textButton} onClick={() => setTimeOpen(false)}>Done</button></div>}
      </div>
      {(view === "review" || canReview) && <div className={styles.entrySave}>{view === "entry" ? <button type="button" className={styles.primary} onClick={() => { if (validated()) { setManualOpen(false); setTimeOpen(false); setError(""); setView("review"); } }}>Review meal</button>
        : <button type="button" className={styles.primary} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save meal"}</button>}</div>}
    </section>}
    <nav className={styles.nav} aria-label="Main"><button type="button" disabled={!journal.ready} aria-current={view === "today" ? "page" : undefined} onClick={() => { if (changeView("today")) { setSelectedDayKey(null); void load(); } }}>Today</button><button type="button" disabled={!journal.ready} className={styles.add} onClick={startNew} aria-label="Add meal">+</button><button type="button" disabled={!journal.ready} aria-current={view === "history" ? "page" : undefined} onClick={() => changeView("history")}>History</button></nav>
  </main>;
}
