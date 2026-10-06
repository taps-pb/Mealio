"use client";

import { useEffect, useMemo, useState } from "react";
import { createNutritionEngine } from "@/lib/nutrition/runtime";
import { importReviewedCorrections } from "@/lib/nutrition/import-corrections";
import { snapshotSchema } from "@/server/meals/validation";
import type { MealItemSnapshot } from "@/server/db/schema";
import { clearEstimatorDrafts, localLibrary, useLocalLibrary } from "./useLocalLibrary";
import LibraryShell from "./LibraryShell";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./Library.module.css";

type Confirmation = { kind: "reset" } | { kind: "import"; file: File } | { kind: "mapping"; phrase: string };
export default function LibrarySettings() {
  const { user, ready, error: loadError, update, notify } = useLocalLibrary();
  const [pending, setPending] = useState<Confirmation | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [corrections, setCorrections] = useState<MealItemSnapshot[]>([]);
  const engine = useMemo(() => createNutritionEngine(user), [user]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const result = snapshotSchema.array().safeParse(JSON.parse(sessionStorage.getItem("mealio-reviewed-snapshots") ?? "[]"));
        if (result.success) setCorrections(result.data.filter((item) => item.portionEdited || item.source === "manual"));
      } catch { /* Only corrections from already loaded, validated history are available. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  async function confirm() {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      if (pending.kind === "reset") { localLibrary().reset(); clearEstimatorDrafts(); notify(); setNotice("Your local library has been reset."); }
      if (pending.kind === "import") { localLibrary().import(await pending.file.text()); clearEstimatorDrafts(); notify(); setNotice("Library imported."); }
      if (pending.kind === "mapping") { update((current) => ({ ...current, mappings: current.mappings.filter((mapping) => mapping.phrase !== pending.phrase) })); clearEstimatorDrafts(); setNotice("Remembered interpretation deleted."); }
    } catch (cause) { setError(pending.kind === "import" ? "Invalid backup or storage unavailable. Your existing library has been retained." : cause instanceof Error ? cause.message : "Could not update the library."); }
    finally { setBusy(false); setPending(null); }
  }
  return <LibraryShell title="Library management" subtitle="Back up and manage foods saved on this device.">
    {(error || loadError) && <p role="alert" className={styles.error}>{error || loadError}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    <section className={styles.section} aria-labelledby="backup-title"><h2 className={styles.sectionTitle} id="backup-title">Backup</h2>
      <p className={styles.hint}>Export a copy before changing devices or clearing browser data.</p>
      <div className={styles.actions} style={{ marginTop: 16 }}><button type="button" className={styles.button} onClick={() => {
        try {
          const url = URL.createObjectURL(new Blob([localLibrary().export()], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "Mealio-local-foods.json"; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Library backup downloaded.");
        } catch { setError("Could not export the local library."); }
      }}>Export library</button></div>
      <label className={styles.field}>Import backup<input type="file" accept="application/json,.json" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        if (file.size > 5_000_000) { setError("Choose a library backup smaller than 5 MB."); return; }
        setPending({ kind: "import", file });
      }} /><small>Importing replaces this device’s current library. You’ll confirm first.</small></label>
    </section>
    <section className={styles.dangerSection} aria-labelledby="corrections-title"><h2 id="corrections-title" className={styles.sectionTitle}>Saved corrections</h2>
      <p>Bring reviewed food corrections from meal history already loaded in this tab into your library.</p>
      <button type="button" className={styles.button} disabled={!ready || !corrections.length} onClick={() => {
        try { let count = 0; update((current) => { const result = importReviewedCorrections(current, corrections); count = result.count; return result.user; }); setNotice(`Imported ${count} reviewed food corrections.`); }
        catch { setError("Could not import corrections. Your saved meal history is unchanged."); }
      }}>Import saved meal corrections</button>
      {!corrections.length && <p className={styles.hint}>Open your meal journal to load available corrections.</p>}
      {!!user.mappings.length && <><h3 className={styles.sectionTitle}>Remembered interpretations</h3><ul className={styles.list}>{user.mappings.map((mapping) => <li key={mapping.phrase} className={styles.row}>
        <div><strong>{mapping.phrase}</strong><small>{engine.catalog.foods.get(mapping.foodId)?.canonicalName}</small></div><button type="button" className={styles.iconButton} aria-label={`Delete remembered interpretation: ${mapping.phrase}`} onClick={() => setPending({ kind: "mapping", phrase: mapping.phrase })}>×</button>
      </li>)}</ul></>}
    </section>
    <section className={styles.dangerSection} aria-labelledby="reset-title"><h2 className={styles.sectionTitle} id="reset-title">Danger zone</h2><p>Reset deletes all custom foods, recipes and remembered interpretations from this device. It does not change your logged meals.</p>
      <button type="button" className={styles.danger} onClick={() => setPending({ kind: "reset" })}>Reset local library</button></section>
    <div className={styles.footer}><a href="/about">About &amp; data sources <span aria-hidden="true">›</span></a></div>
    {pending && <ConfirmDialog title={pending.kind === "reset" ? "Reset your local library?" : pending.kind === "import" ? "Replace your local library?" : `Delete interpretation “${pending.phrase}”?`}
      action={pending.kind === "reset" ? "Reset library" : pending.kind === "import" ? "Import backup" : "Delete"} busy={busy} onCancel={() => { if (!busy) setPending(null); }} onConfirm={() => void confirm()}>
      <p>{pending.kind === "reset" ? "All custom foods, recipes and remembered interpretations on this device will be deleted. Export a backup first if you want to keep them." : pending.kind === "import" ? `“${pending.file.name}” will replace your current foods, recipes and remembered interpretations.` : "Mealio will stop automatically using this saved interpretation. Your custom foods will remain."}</p>
    </ConfirmDialog>}
  </LibraryShell>;
}
