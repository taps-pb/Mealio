"use client";

import { useEffect, useMemo, useState } from "react";
import { createNutritionEngine } from "@/lib/nutrition/runtime";
import { scaleNutrition } from "@/lib/nutrition/calculate";
import { formatCalories } from "@/lib/formatCalories";
import { useLocalLibrary } from "./useLocalLibrary";
import LibraryShell from "./LibraryShell";
import NutritionSummary from "./NutritionSummary";
import styles from "./Library.module.css";

export default function LibraryDetails() {
  const { user, ready, error } = useLocalLibrary();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => setId(new URLSearchParams(location.search).get("id") ?? "")); return () => cancelAnimationFrame(frame); }, []);
  const engine = useMemo(() => createNutritionEngine(user), [user]);
  const food = user.foods.find((food) => food.id === id), recipe = food && engine.catalog.recipes.get(food.id);
  const portion = food && user.portions.find((portion) => portion.id === food.defaultPortion);
  const per100 = food && engine.catalog.nutrition(food.id);
  const total = per100 && scaleNutrition(per100, recipe?.yieldGrams ?? portion?.amount ?? 100);
  return <LibraryShell title={food?.canonicalName ?? "Saved food"} subtitle={food ? recipe ? "Your saved recipe" : "Your custom food" : undefined} back={recipe ? "/foods?tab=recipes" : "/foods"}>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!ready || id === null ? <p role="status">Loading…</p> : !food ? <p>This food is no longer in your local library.</p> : <>
      {total && <NutritionSummary total={total} servings={recipe?.servings} title={recipe ? "Estimated recipe nutrition" : "Nutrition for your defined serving"} />}
      <section className={styles.dangerSection}><h2 className={styles.sectionTitle}>{recipe ? "Yield & servings" : "Serving"}</h2>
        <p>{recipe ? `${formatCalories(recipe.yieldGrams)} g cooked · ${recipe.servings} servings` : portion ? `${portion.amount} ${portion.basis === "serving" ? portion.unit : portion.basis}` : "No defined serving"}</p>
        {recipe && portion && <p className={styles.hint}>1 {portion.unit} = {formatCalories(portion.amount)} g</p>}
      </section>
      {recipe && <section className={styles.dangerSection}><h2 className={styles.sectionTitle}>Ingredients</h2><ul className={styles.list}>{recipe.ingredients.map((ingredient, index) => <li className={styles.row} key={index}><div><strong>{engine.catalog.foods.get(ingredient.foodId)?.canonicalName}</strong><small>{ingredient.preparation} · {formatCalories(ingredient.amount)} {ingredient.basis}</small></div></li>)}</ul></section>}
      <p className={styles.hint}>Use “1 {portion?.unit ?? "serving"} {food.canonicalName}” when estimating a meal.</p>
    </>}
  </LibraryShell>;
}
