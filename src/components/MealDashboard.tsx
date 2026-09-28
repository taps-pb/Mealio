"use client";

import { useCallback, useEffect, useState } from "react";
import HistoryPanel from "./HistoryPanel";
import MealRing from "./MealRing";
import styles from "./MealDashboard.module.css";

type Macro = { kcal: number; protein: number; carbs: number };
type Snapshot = {
  name: string; quantity: number | null; unit: string | null; grams: number | null;
  kcal: number | null; protein: number | null; carbs: number | null;
  source: "usda" | "indb" | "manual" | "unmatched"; sourceId: string | null; uncertainty: string | null;
};
type Meal = Macro & { id: string; description: string; eatenAt: string; itemSnapshots: Snapshot[]; provenance: "manual" | "estimated" | "corrected" };
type DayGroup = { day: string; meals: Meal[]; totalKcal: number; totalProtein: number; totalCarbs: number };
type Draft = {
  id: string | null; key: string; description: string; eatenAt: string; originalEatenAt: string | null; timeChanged: boolean;
  kcal: string; protein: string; carbs: string; items: Snapshot[]; provenance: Meal["provenance"];
};
type View = "today" | "history" | "entry" | "review" | "details";
const pad = (number: number) => String(number).padStart(2, "0");
const localInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const round2 = (number: number) => Math.round(number * 100) / 100;

export default function MealDashboard({ username, timezone, onLogout }: { username: string; timezone: string; onLogout: () => void }) {
  const [view, setView] = useState<View>("today");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailsFrom, setDetailsFrom] = useState<"today" | "history">("today");
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [todayKey, setTodayKey] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/meals", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) { onLogout(); return; }
      if (!response.ok) throw new Error("meal list unavailable");
      const data: { todayKey: string; groups: DayGroup[] } = await response.json();
      setTodayKey(data.todayKey);
      setGroups(data.groups);
      setLoaded(true);
      setError("");
    } catch { setLoaded(true); setError("Could not load meals. Try again."); }
  }, [onLogout]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(frame);
  }, [load]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDark(localStorage.getItem("mealio-theme") === "dark"));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  const today = groups.find((group) => group.day === todayKey);
  const changeView = (next: View) => {
    if (draft && !window.confirm("Discard your unsaved meal changes?")) return;
    setDraft(null); setError(""); setView(next);
  };
  const startNew = () => {
    if (draft && !window.confirm("Discard your unsaved meal changes?")) return;
    setDraft({ id: null, key: crypto.randomUUID(), description: "", eatenAt: localInput(new Date()), originalEatenAt: null,
      timeChanged: true, kcal: "", protein: "", carbs: "", items: [], provenance: "manual" });
    setError(""); setView("entry");
  };
  const startEdit = (meal: Meal) => {
    setDraft({ id: meal.id, key: "", description: meal.description, eatenAt: localInput(new Date(meal.eatenAt)),
      originalEatenAt: meal.eatenAt, timeChanged: false, kcal: String(meal.kcal), protein: String(meal.protein),
      carbs: String(meal.carbs), items: meal.itemSnapshots, provenance: meal.provenance });
    setError(""); setView("entry");
  };

  async function estimate() {
    if (!draft?.description.trim()) { setError("Describe your meal first."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/estimate", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: draft.description }) });
      if (response.status === 401) { onLogout(); return; }
      if (!response.ok) { setError("Estimate unavailable. Enter nutrition manually instead."); return; }
      const result: { items: Snapshot[]; totals: Macro | null; incomplete: boolean } = await response.json();
      setDraft((current) => current ? {
        ...current, items: result.items,
        // An explicit estimate must never silently replace manual corrections.
        kcal: current.kcal || (result.totals ? String(result.totals.kcal) : ""),
        protein: current.protein || (result.totals ? String(result.totals.protein) : ""),
        carbs: current.carbs || (result.totals ? String(result.totals.carbs) : ""),
        provenance: current.kcal || current.protein || current.carbs ? "corrected" : "estimated",
      } : null);
      if (result.incomplete) setError("Some foods or portions are uncertain. Fill missing values and review the totals.");
    } catch { setError("Estimate unavailable. Enter nutrition manually instead."); }
    finally { setBusy(false); }
  }

  function updateItem(index: number, patch: Partial<Snapshot>) {
    setDraft((current) => current ? { ...current, provenance: "corrected",
      items: current.items.map((item, number) => number === index ? { ...item, ...patch, source: "manual", sourceId: null } : item) } : null);
  }
  function useItemSums() {
    if (!draft?.items.length || draft.items.some((item) => item.kcal === null || item.protein === null || item.carbs === null)) {
      setError("Fill each item's calories, protein, and carbs before using item sums."); return;
    }
    const sum = draft.items.reduce<Macro>((total, item) => ({
      kcal: total.kcal + (item.kcal ?? 0), protein: total.protein + (item.protein ?? 0), carbs: total.carbs + (item.carbs ?? 0),
    }), { kcal: 0, protein: 0, carbs: 0 });
    setDraft({ ...draft, kcal: String(round2(sum.kcal)), protein: String(round2(sum.protein)), carbs: String(round2(sum.carbs)), provenance: "corrected" });
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
          value > 99_999_999.99 || Math.abs(value * 100 - Math.round(value * 100)) > .00001));
    })) { setError("Check food names, positive portions, and item nutrients (at most two decimals)."); return null; }
    const numbers = [draft.kcal, draft.protein, draft.carbs].map(Number);
    if ([draft.kcal, draft.protein, draft.carbs].some((value) => value.trim() === "") ||
        numbers.some((value) => !Number.isFinite(value) || value < 0 || value > 99_999_999.99 || Math.abs(value * 100 - Math.round(value * 100)) > .00001)) {
      setError("Enter non-negative kcal, protein, and carbs with at most two decimals."); return null;
    }
    const instant = new Date(draft.eatenAt);
    if (!draft.eatenAt || !Number.isFinite(instant.getTime()) || localInput(instant) !== draft.eatenAt) {
      setError("Choose a valid device-local date and time."); return null;
    }
    return { description: draft.description.trim(), eatenAt: draft.timeChanged ? instant.toISOString() : draft.originalEatenAt ?? instant.toISOString(),
      kcal: numbers[0], protein: numbers[1], carbs: numbers[2], itemSnapshots: draft.items, provenance: draft.provenance };
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
      onLogout();
    } catch { setError("Could not log out. Try again."); }
    finally { setBusy(false); }
  }

  const detailMeal = groups.flatMap((group) => group.meals).find((meal) => meal.id === detailId);
  const renderMeal = (meal: Meal) => <article key={meal.id} className={styles.meal}>
    <span className={styles.mealIcon} aria-hidden="true">✦</span>
    <div className={styles.mealCopy}><strong>{meal.description}</strong><small>{new Date(meal.eatenAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone })} · P {meal.protein}g · C {meal.carbs}g</small>{meal.itemSnapshots.some((item) => item.uncertainty) && <small>Contains uncertain items</small>}</div>
    <div className={styles.mealKcal}>{meal.kcal}<small>kcal</small></div>
    <div className={styles.mealActions}><button type="button" onClick={() => { setDetailId(meal.id); setDetailsFrom(view === "history" ? "history" : "today"); setDeleteId(null); setView("details"); }}>Details</button><button type="button" onClick={() => startEdit(meal)}>Edit</button><button type="button" onClick={() => setDeleteId(meal.id)}>Delete</button></div>
    {deleteId === meal.id && <div className={styles.confirm}><span>Delete {meal.description}?</span><button type="button" disabled={busy} onClick={() => void remove(meal.id)}>Yes, delete</button><button type="button" onClick={() => setDeleteId(null)}>Cancel</button></div>}
  </article>;

  return <main className={styles.app}>
    <header className={styles.header}><div><span className={styles.eyebrow}>YOUR MEAL JOURNAL · {username}</span><h1>Mealio<span>.</span></h1></div><div className={styles.headerActions}><button type="button" aria-label={`Switch to ${dark ? "light" : "dark"} mode`} onClick={() => { const next = !dark; setDark(next); localStorage.setItem("mealio-theme", next ? "dark" : "light"); }}>{dark ? "☀" : "☾"}</button><button type="button" disabled={busy} onClick={() => void logout()}>Log out</button></div></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!loaded && <p role="status">Loading meals…</p>}

    {view === "today" && loaded && <><section className={styles.hero}><div className={styles.heading}><div><span className={styles.eyebrow}>CALORIES BY MEAL</span><h2>Today</h2></div><span>{todayKey} · {timezone}</span></div><MealRing meals={(today?.meals ?? []).map((meal) => ({ id: meal.id, name: meal.description, kcal: meal.kcal }))} /><div className={styles.macros}><div><span className={styles.macroIcon} aria-hidden="true">P</span><span><small>Protein</small><strong>{today?.totalProtein ?? 0} g</strong></span></div><div><span className={styles.macroIcon} aria-hidden="true">C</span><span><small>Carbs</small><strong>{today?.totalCarbs ?? 0} g</strong></span></div></div></section><section className={styles.list}><div className={styles.heading}><h2>Meals today</h2><span>{today?.meals.length ?? 0} logged</span></div>{today?.meals.length ? today.meals.map(renderMeal) : <p className={styles.empty}>No meals yet. Add one to start your day.</p>}</section></>}
    {loaded && <div hidden={view !== "history"}><HistoryPanel groups={groups} timezone={timezone} onOpenDetails={(meal) => { setDetailId(meal.id); setDetailsFrom("history"); setDeleteId(null); setView("details"); }} /></div>}

    {view === "details" && loaded && <section className={styles.editor}><span className={styles.eyebrow}>SAVED MEAL</span><h2>Meal details</h2>{detailMeal ? <><p>{new Date(detailMeal.eatenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone })} · {timezone}</p><h3>{detailMeal.description}</h3><div className={styles.macros}><div><small>Calories</small><strong>{detailMeal.kcal} kcal</strong></div><div><small>Protein</small><strong>{detailMeal.protein} g</strong></div><div><small>Carbs</small><strong>{detailMeal.carbs} g</strong></div></div><p>Saved nutrition snapshot · {detailMeal.provenance}. Re-estimating is always an explicit action in Edit.</p>{detailMeal.itemSnapshots.map((item, index) => <div className={styles.item} key={index}><strong>{item.name}</strong><span className={styles.sourceBadge}>{item.source === "indb" ? "INDB candidate" : item.source === "usda" ? "USDA candidate" : item.source}</span>{item.sourceId && <p>Reference: {item.sourceId}</p>}<p>{item.quantity ?? "—"} {item.unit ?? ""}{item.grams !== null ? ` · ${item.grams} g` : ""} · {item.kcal ?? "—"} kcal · P {item.protein ?? "—"} g · C {item.carbs ?? "—"} g</p>{item.uncertainty && <p className={styles.uncertain}>Uncertain: {item.uncertainty}</p>}</div>)}<div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => startEdit(detailMeal)}>Edit meal</button><button type="button" className={styles.secondary} onClick={() => setDeleteId(detailMeal.id)}>Delete…</button></div>{deleteId === detailMeal.id && <div className={styles.confirm}><span>Delete {detailMeal.description}?</span><button type="button" disabled={busy} onClick={() => void remove(detailMeal.id)}>Yes, delete</button><button type="button" onClick={() => setDeleteId(null)}>Cancel</button></div>}</> : <p role="status">Meal not found. Return to history.</p>}<button type="button" className={styles.secondary} onClick={() => changeView(detailsFrom)}>Back to {detailsFrom === "today" ? "Today" : "History"}</button></section>}

    {(view === "entry" || view === "review") && draft && <section className={styles.editor}><span className={styles.eyebrow}>{draft.id ? "EDIT MEAL" : "NEW MEAL"}</span><h2>{view === "review" ? "Review before saving" : "What did you eat?"}</h2><p>Describe foods and portions, then review estimates or enter nutrition manually. Candidates may be uncertain; your corrections are saved only when you confirm.</p>
      {view === "entry" && <><label>Meal description<textarea rows={3} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><button type="button" className={styles.secondary} disabled={busy || !draft.description.trim()} onClick={() => void estimate()}>Estimate from description (optional)</button></>}
      {!!draft.items.length && <div className={styles.items}><h3>Food and portion assumptions</h3>{draft.items.map((item, index) => <fieldset key={index} className={styles.item}><legend>Item {index + 1} · {item.source === "indb" ? <><span className={styles.sourceBadge}>INDB candidate</span> {item.sourceId}</> : item.source === "usda" ? "USDA candidate" : item.source}</legend>{item.uncertainty && <p className={styles.uncertain}>Uncertain: {item.uncertainty}</p>}
        <label>Food name<input value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} /></label><div className={styles.fields}><label>Quantity<input type="number" min="0.01" step="any" value={item.quantity ?? ""} onChange={(event) => updateItem(index, { quantity: event.target.value ? Number(event.target.value) : null })} /></label><label>Unit<input value={item.unit ?? ""} onChange={(event) => updateItem(index, { unit: event.target.value || null })} /></label><label>Grams<input type="number" min="0.01" step="any" value={item.grams ?? ""} onChange={(event) => updateItem(index, { grams: event.target.value ? Number(event.target.value) : null })} /></label></div>
        <div className={styles.fields}>{(["kcal", "protein", "carbs"] as const).map((field) => <label key={field}>{field === "kcal" ? "Calories" : field}<input type="number" min="0" step="0.01" value={item[field] ?? ""} onChange={(event) => updateItem(index, { [field]: event.target.value === "" ? null : Number(event.target.value) })} /></label>)}</div>
      </fieldset>)}<button type="button" className={styles.secondary} onClick={useItemSums}>Use item sums for meal totals</button><p>Editing an item does not silently change the meal totals below.</p></div>}
      <div className={styles.fields}>{(["kcal", "protein", "carbs"] as const).map((field) => <label key={field}>{field === "kcal" ? "Meal calories" : `Meal ${field} (g)`}<input type="number" min="0" step="0.01" value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value, provenance: "corrected" })} /></label>)}</div>
      <label>When eaten (device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone})<input type="datetime-local" value={draft.eatenAt} onChange={(event) => setDraft({ ...draft, eatenAt: event.target.value, timeChanged: true })} /></label><p>History is grouped in your account timezone: {timezone}.</p>
      <div className={styles.actions}>{view === "entry" ? <button type="button" className={styles.primary} onClick={() => { if (validated()) { setError(""); setView("review"); } }}>Review meal</button> : <><button type="button" className={styles.secondary} onClick={() => setView("entry")}>Back to edit</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void save()}>Save meal</button></>}</div>
    </section>}
    <nav className={styles.nav} aria-label="Main"><button type="button" aria-current={view === "today" ? "page" : undefined} onClick={() => changeView("today")}>Today</button><button type="button" className={styles.add} onClick={startNew} aria-label="Add meal">+</button><button type="button" aria-current={view === "history" ? "page" : undefined} onClick={() => changeView("history")}>History</button></nav>
  </main>;
}
