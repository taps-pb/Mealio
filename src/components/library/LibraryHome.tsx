"use client";

import { useEffect, useMemo, useState } from "react";
import { createNutritionEngine } from "@/lib/nutrition/runtime";
import { scaleNutrition } from "@/lib/nutrition/calculate";
import { removeCustomFood } from "@/lib/nutrition/user-library";
import { formatCalories } from "@/lib/formatCalories";
import type { Food } from "@/lib/nutrition/types";
import { useLocalLibrary } from "./useLocalLibrary";
import LibraryShell from "./LibraryShell";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./Library.module.css";

export default function LibraryHome() {
  const { user, ready, error: loadError, update } = useLocalLibrary();
  const [tab, setTab] = useState("foods"), [notice, setNotice] = useState("");
  const [error, setError] = useState(""), [pending, setPending] = useState<Food | null>(null);
  const engine = useMemo(() => createNutritionEngine(user), [user]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const params = new URLSearchParams(location.search);
      setTab(params.get("tab") === "recipes" ? "recipes" : "foods");
      if (params.get("saved") === "1") { setNotice("Saved on this device."); history.replaceState(null, "", `/foods?tab=${params.get("tab") === "recipes" ? "recipes" : "foods"}`); }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const foods = user.foods.filter((food) => user.recipes.some((recipe) => recipe.foodId === food.id) === (tab === "recipes"));
  return <LibraryShell title="My foods & recipes" subtitle="Foods and recipes saved on this device." back={null}>
    <div className={styles.actions}><a className={styles.button} href="/foods/new">+ Add food</a><a className={styles.primary} href="/foods/recipes/new">+ Add recipe</a></div>
    <nav className={styles.tabs} aria-label="Library categories"><a href="/foods?tab=foods" aria-current={tab === "foods" ? "page" : undefined}>Foods <span>({user.foods.length - user.recipes.length})</span></a><a href="/foods?tab=recipes" aria-current={tab === "recipes" ? "page" : undefined}>Recipes <span>({user.recipes.length})</span></a></nav>
    {(error || loadError) && <p role="alert" className={styles.error}>{error || loadError}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!ready && !loadError && <p role="status">Loading your library…</p>}
    {ready && <ul className={styles.list} aria-label={tab === "recipes" ? "Saved recipes" : "Saved foods"}>{foods.map((food) => {
      const recipe = engine.catalog.recipes.get(food.id), nutrition = engine.catalog.nutrition(food.id);
      const portion = user.portions.find((p) => p.id === food.defaultPortion);
      const total = nutrition && scaleNutrition(nutrition, recipe?.yieldGrams ?? portion?.amount ?? 100);
      return <li className={styles.row} key={food.id}><span className={styles.rowIcon} aria-hidden="true">{recipe ? "≋" : "✦"}</span>
        <a className={styles.rowLink} href={`/foods/details?id=${encodeURIComponent(food.id)}`}><strong>{food.canonicalName}</strong><small>{recipe ? `${recipe.servings} ${recipe.servings === 1 ? "serving" : "servings"} · ${total ? formatCalories(total.kcal) : "—"} kcal total`
          : `Custom food${portion ? ` · ${portion.basis === "serving" ? 1 : portion.amount} ${portion.unit}` : ""}`}</small></a>
        <details className={styles.menu}><summary className={styles.iconButton} aria-label={`Actions for ${food.canonicalName}`}>⋮</summary><div className={styles.menuItems}><button type="button" onClick={(event) => {
          event.currentTarget.closest("details")?.removeAttribute("open"); setPending(food);
        }}>Delete</button></div></details>
      </li>;
    })}</ul>}
    {ready && !foods.length && <div className={styles.empty}><strong>{tab === "recipes" ? "Your recipes, ready to reuse" : "Make everyday foods your own"}</strong><p>{tab === "recipes" ? "Add ingredients once. Save a recipe for next time." : "Save a food’s label nutrition for a quicker meal estimate."}</p></div>}
    <div className={styles.footer}><a href="/foods/settings">Library settings <span aria-hidden="true">›</span></a><a href="/about">About Mealio <span aria-hidden="true">›</span></a><p>Stored in this browser. Your existing library is kept when you update Mealio.</p></div>
    {pending && <ConfirmDialog title={`Delete “${pending.canonicalName}”?`} onCancel={() => setPending(null)} onConfirm={() => {
      try { update((current) => removeCustomFood(current, pending.id)); setNotice(`Deleted “${pending.canonicalName}”.`); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete this food."); }
      setPending(null);
    }}><p>This removes it from your local {tab === "recipes" ? "recipe" : "food"} library. Nutrition already saved in meal history stays unchanged.</p></ConfirmDialog>}
  </LibraryShell>;
}
