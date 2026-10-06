"use client";

import Link from "next/link";
import { useId } from "react";
import LocalEstimator from "./LocalEstimator";
import type { Estimate } from "@/lib/nutrition/types";
import { formatCalories } from "@/lib/formatCalories";
import styles from "./MealDashboard.module.css";
import OfflineCache from "./library/OfflineCache";
import ThemeToggle from "./ThemeToggle";
import { useSessionState } from "@/lib/useSessionState";

type Draft = { description: string; result: Estimate | null };
const initial: Draft = { description: "", result: null };
const isDraft = (value: unknown): value is Draft => !!value && typeof value === "object" && "description" in value && typeof value.description === "string" && "result" in value;

export default function OfflineNutrition() {
  const descriptionId = useId();
  const draft = useSessionState("mealio-offline-draft", initial, isDraft);
  const { description, result } = draft.value;
  return <main className={styles.app}>
    <header className={styles.header}><div><span className={styles.eyebrow}>LOCAL NUTRITION</span><h1>Mealio<span>.</span></h1></div><div className={styles.headerActions}><ThemeToggle /></div></header>
    <section className={styles.editor}><h2>Offline food estimator</h2><OfflineCache />
      <p>Estimate on this device. Save meals in your <Link href="/" prefetch={false}>meal journal</Link>.</p>
      <label htmlFor={descriptionId}>Meal description</label><textarea id={descriptionId} disabled={!draft.ready} rows={3} maxLength={500} value={description} onChange={(event) => draft.setValue((current) => ({ ...current, description: event.target.value }))} />
      {result?.rawText === description && <p aria-label="Nutrition total">{result.totals
        ? `${formatCalories(result.totals.kcal)} kcal · P ${formatCalories(result.totals.protein)} g · C ${formatCalories(result.totals.carbs)} g · F ${formatCalories(result.totals.fat)} g`
        : "Some foods need clarification; no complete meal total yet."}</p>}
      <LocalEstimator sessionKey="offline" description={description} onEstimate={(result) => draft.setValue((current) => ({ ...current, result }))} returnTo="/nutrition" beforeNavigate={draft.persist} />
    </section>
  </main>;
}
