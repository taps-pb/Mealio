import { formatCalories } from "@/lib/formatCalories";
import { scaleNutrition } from "@/lib/nutrition/calculate";
import type { Nutrition } from "@/lib/nutrition/types";
import styles from "./Library.module.css";

function Values({ nutrition }: { nutrition: Nutrition }) {
  return <dl className={styles.nutrition}>{([["Calories", "kcal", "kcal"], ["Protein", "protein", "g"], ["Carbs", "carbs", "g"], ["Fat", "fat", "g"]] as const)
    .map(([label, key, unit]) => <div key={key}><dt>{label}</dt><dd>{formatCalories(nutrition[key])} {unit}</dd></div>)}</dl>;
}
export default function NutritionSummary({ total, servings, title = "Estimated recipe nutrition" }: { total: Nutrition; servings?: number; title?: string }) {
  return <section className={styles.preview} aria-label={title}><h2>{title}</h2><Values nutrition={total} />
    {servings !== undefined && servings > 0 && Number.isFinite(servings) && <><h3>Per serving · 1 of {servings}</h3><Values nutrition={scaleNutrition(total, 100 / servings)} /></>}
  </section>;
}
