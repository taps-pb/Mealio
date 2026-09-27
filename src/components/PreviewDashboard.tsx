"use client";

import { useEffect, useState } from "react";
import MealRing from "@/components/MealRing";
import styles from "@/app/page.module.css";

type Meal = { id: string; name: string; kcal: number; protein: number; carbs: number; eatenAt: string };
type Draft = { name: string; kcal: string; protein: string; carbs: string; eatenAt: string };
type View = "today" | "new" | "review" | "history";

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const localDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const totals = (meals: Meal[]) => meals.reduce((sum, meal) => ({
  kcal: sum.kcal + meal.kcal, protein: sum.protein + meal.protein, carbs: sum.carbs + meal.carbs,
}), { kcal: 0, protein: 0, carbs: 0 });
const sample = (today: Date): Meal[] => [
  { id: "sample-1", name: "Yogurt bowl", kcal: 320, protein: 23, carbs: 42, eatenAt: localInput(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 15)) },
  { id: "sample-2", name: "Chicken & rice", kcal: 610, protein: 42, carbs: 66, eatenAt: localInput(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13)) },
];

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [view, setView] = useState<View>("today");
  const [draft, setDraft] = useState<Draft>({ name: "", kcal: "", protein: "", carbs: "", eatenAt: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const today = new Date();
      setNow(today);
      setMeals(sample(today));
      if (localStorage.getItem("mealio-theme") === "dark") setDark(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    if (now) localStorage.setItem("mealio-theme", dark ? "dark" : "light");
  }, [dark, now]);

  const day = now ? localDay(now) : "";
  const todayMeals = meals.filter((meal) => localDay(new Date(meal.eatenAt)) === day);
  const todayTotals = totals(todayMeals);
  const groups = Object.entries(Object.groupBy(meals, (meal) => localDay(new Date(meal.eatenAt))))
    .sort(([a], [b]) => b.localeCompare(a));

  function openNew() {
    setEditing(null);
    setDraft({ name: "", kcal: "", protein: "", carbs: "", eatenAt: localInput(new Date()) });
    setError("");
    setView("new");
  }

  function openEdit(meal: Meal) {
    setEditing(meal.id);
    setDraft({ name: meal.name, kcal: String(meal.kcal), protein: String(meal.protein), carbs: String(meal.carbs), eatenAt: meal.eatenAt });
    setError("");
    setView("new");
  }

  function parseDraft(): Meal | null {
    const kcal = Number(draft.kcal), protein = Number(draft.protein), carbs = Number(draft.carbs);
    if (!draft.name.trim() || !draft.eatenAt || Number.isNaN(new Date(draft.eatenAt).getTime()) ||
        !draft.kcal.trim() || !draft.protein.trim() || !draft.carbs.trim() ||
        ![kcal, protein, carbs].every((value) => Number.isFinite(value) && value >= 0)) {
      setError("Enter a meal, date/time, and non-negative calories, protein, and carbs.");
      return null;
    }
    return { id: editing ?? crypto.randomUUID(), name: draft.name.trim(), kcal, protein, carbs, eatenAt: draft.eatenAt };
  }

  function save() {
    const meal = parseDraft();
    if (!meal) return;
    setMeals((current) => editing ? current.map((item) => item.id === editing ? meal : item) : [...current, meal]);
    setView("today");
    setEditing(null);
  }

  const mealRow = (meal: Meal) => <article key={meal.id} className={styles.meal}>
    <span className={styles.mealIcon} aria-hidden="true">✦</span>
    <div className={styles.mealCopy}><strong>{meal.name}</strong><small>{new Date(meal.eatenAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · P {meal.protein}g · C {meal.carbs}g</small></div>
    <span className={styles.kcal}>{meal.kcal}<small>kcal</small></span>
    <div className={styles.mealActions}><button type="button" onClick={() => openEdit(meal)}>Edit</button><button type="button" onClick={() => setConfirmId(meal.id)}>Delete</button></div>
    {confirmId === meal.id && <div className={styles.confirm}>Delete {meal.name}? <button type="button" onClick={() => { setMeals((current) => current.filter((item) => item.id !== meal.id)); setConfirmId(null); }}>Yes, delete</button><button type="button" onClick={() => setConfirmId(null)}>Cancel</button></div>}
  </article>;

  return <main className={styles.app}>
    <header className={styles.header}><div><span className={styles.eyebrow}>YOUR MEAL JOURNAL</span><h1>Mealio<span aria-hidden="true">.</span></h1></div><button type="button" className={styles.theme} onClick={() => setDark((value) => !value)} aria-label={`Switch to ${dark ? "light" : "dark"} mode`}>{dark ? "☀" : "☾"}</button></header>
    <p className={styles.demo} role="note">UI preview · sample data only · no account, AI, or saved server data</p>

    {view === "today" && <>
      <section className={styles.hero} aria-label="Today summary"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>YOUR DAY AT A GLANCE</span><h2>Today</h2></div><span>{now?.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div><p className={styles.chartLabel}>CALORIES BY MEAL</p><MealRing meals={todayMeals} /><div className={styles.macros}><div><span className={styles.macroIcon}>P</span><div><small>Protein</small><strong>{todayTotals.protein} g</strong></div></div><div><span className={styles.macroIcon}>C</span><div><small>Carbs</small><strong>{todayTotals.carbs} g</strong></div></div></div></section>
      <section className={styles.list}><div className={styles.sectionHeading}><h2>Meals today</h2><span>{todayMeals.length} logged</span></div>{todayMeals.length ? todayMeals.map(mealRow) : <p className={styles.empty}>No meals yet. Add a meal to start your day.</p>}</section>
    </>}

    {(view === "new" || view === "review") && <section className={styles.formCard}><span className={styles.eyebrow}>{editing ? "EDIT ENTRY" : "NEW ENTRY"}</span><h2>{view === "new" ? "What did you eat?" : "Review before logging"}</h2><p className={styles.hint}>Manual demo only. No nutrition estimate or food database lookup has run.</p>{view === "new" ? <form onSubmit={(event) => { event.preventDefault(); if (parseDraft()) { setError(""); setView("review"); } }}>
      <label>Meal description<textarea rows={3} required placeholder="e.g. Rice, chicken and vegetables" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className={styles.fieldGrid}>{(["kcal", "protein", "carbs"] as const).map((field) => <label key={field}>{field === "kcal" ? "Calories (kcal)" : `${field[0].toUpperCase()}${field.slice(1)} (g)`}<input type="number" min="0" step="any" required value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></label>)}</div>
      <label>When did you eat?<input type="datetime-local" required value={draft.eatenAt} onChange={(event) => setDraft({ ...draft, eatenAt: event.target.value })} /></label>{error && <p role="alert" className={styles.error}>{error}</p>}<button className={styles.primary} type="submit">Review meal</button>
    </form> : <div className={styles.review}><strong>{draft.name}</strong><p>{draft.kcal} kcal · {draft.protein} g protein · {draft.carbs} g carbs</p><p>{draft.eatenAt.replace("T", " ")}</p>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={styles.actions}><button type="button" onClick={() => setView("new")}>Back to edit</button><button className={styles.primary} type="button" onClick={save}>Save meal</button></div></div>}</section>}

    {view === "history" && <section className={styles.list}><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>THE FULL PICTURE</span><h2>History</h2></div></div>{groups.map(([date, group]) => { const entries = group ?? []; const sum = totals(entries); return <div key={date} className={styles.day}><div className={styles.dayHeading}><strong>{date}</strong><span>{sum.kcal} kcal · P {sum.protein}g · C {sum.carbs}g</span></div>{entries.map(mealRow)}</div>; })}{!groups.length && <p className={styles.empty}>No meals logged yet.</p>}</section>}

    <nav className={styles.nav} aria-label="Main"><button type="button" aria-current={view === "today" ? "page" : undefined} onClick={() => setView("today")}>Today</button><button type="button" className={styles.add} onClick={openNew} aria-label="Add meal">+</button><button type="button" aria-current={view === "history" ? "page" : undefined} onClick={() => setView("history")}>History</button></nav>
  </main>;
}
