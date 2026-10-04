"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import LocalEstimator from "./LocalEstimator";
import type { Estimate } from "@/lib/nutrition/types";
import { formatCalories } from "@/lib/formatCalories";
import styles from "./MealDashboard.module.css";

export default function OfflineNutrition() {
  const descriptionId = useId();
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<Estimate | null>(null);
  const [offlineReady, setOfflineReady] = useState("Preparing offline page…");
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let alive = true;
    navigator.serviceWorker.register("/nutrition/sw.js", { scope: "/nutrition" }).then(async () => {
      await navigator.serviceWorker.ready;
      if (alive) setOfflineReady("Ready for offline use on this device.");
    }).catch(() => { if (alive) setOfflineReady("Estimator works locally; offline page caching is unavailable in this browser/build."); });
    return () => { alive = false; };
  }, []);
  return <main className={styles.app}>
    <header className={styles.header}><div><span className={styles.eyebrow}>LOCAL NUTRITION</span><h1>Mealio<span>.</span></h1></div><Link href="/" prefetch={false}>Meal journal</Link></header>
    <section className={styles.editor}><h2>Offline food estimator</h2><p role="status">{offlineReady}</p>
      <p>Estimate, teach foods and save recipes here without a connection. Meal history and logging use your usual authenticated journal.</p>
      <label htmlFor={descriptionId}>Meal description</label><textarea id={descriptionId} rows={4} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
      {result?.rawText === description && <p aria-label="Nutrition total">{result.totals
        ? `${formatCalories(result.totals.kcal)} kcal · P ${formatCalories(result.totals.protein)} g · C ${formatCalories(result.totals.carbs)} g · F ${formatCalories(result.totals.fat)} g`
        : "Some foods need clarification; no complete meal total yet."}</p>}
      <LocalEstimator description={description} onEstimate={setResult} />
    </section>
  </main>;
}
