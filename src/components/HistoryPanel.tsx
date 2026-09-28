"use client";

import { useId, useMemo, useState } from "react";
import { filterAndSortHistory, historyExportHref, historyTotals, type HistoryGroup, type HistoryMeal, type HistorySort } from "@/lib/history";
import styles from "./HistoryPanel.module.css";

type DisplayMeal = HistoryMeal & { itemSnapshots: { uncertainty: string | null }[] };
type Props<M extends DisplayMeal> = { groups: HistoryGroup<M>[]; timezone: string; onOpenDetails: (meal: M) => void };

function labelDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, date)));
}

export default function HistoryPanel<M extends DisplayMeal>({ groups, timezone, onOpenDetails }: Props<M>) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<HistorySort>("new");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [showDates, setShowDates] = useState(false);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const datesId = useId();
  const dayId = useId();
  const options = useMemo(() => ({ search, sort, from, through }), [search, sort, from, through]);
  const invalidRange = !!from && !!through && from > through;
  const visible = useMemo(() => filterAndSortHistory(groups, options), [groups, options]);
  const totals = historyTotals(visible);
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone }), [timezone]);
  const hasFilters = !!search || !!from || !!through || sort !== "new";
  const tooMany = totals.count > 3000;

  return <section className={styles.panel} aria-label="Meal history">
    <span className={styles.eyebrow}>YOUR MEAL JOURNAL</span>
    <h2>History</h2>
    <p className={styles.intro}>Saved meals · grouped in {timezone}</p>
    <label className={styles.field}>Find a meal<input type="search" value={search} maxLength={100} placeholder="e.g. paneer, roti" onChange={(event) => setSearch(event.target.value)} /></label>
    <div className={styles.toolbar}>
      <label className={styles.field}>Sort by<select value={sort} onChange={(event) => setSort(event.target.value as HistorySort)}><option value="new">Newest first</option><option value="old">Oldest first</option><option value="kcal-desc">Most calories</option><option value="kcal-asc">Fewest calories</option></select></label>
      <button type="button" className={styles.secondary} aria-expanded={showDates} aria-controls={datesId} onClick={() => setShowDates((current) => !current)}>Date range{from || through ? " · active" : ""}</button>
    </div>
    <div id={datesId} className={styles.datePanel} hidden={!showDates}><strong>Dates in {timezone}</strong><div className={styles.dateFields}><label className={styles.field}>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className={styles.field}>Through<input type="date" value={through} onChange={(event) => setThrough(event.target.value)} /></label></div><button type="button" className={styles.secondary} onClick={() => { setFrom(""); setThrough(""); }}>Clear dates</button></div>
    {invalidRange && <p role="alert" className={styles.notice}>“From” must be on or before “Through”.</p>}
    {tooMany && <p role="alert" className={styles.notice}>Select a narrower range to export up to 3,000 meals at a time.</p>}
    <div className={styles.summary} role="status" aria-live="polite"><strong>{totals.count} {totals.count === 1 ? "meal" : "meals"} · {totals.days} {totals.days === 1 ? "day" : "days"}</strong><span>{totals.kcal} kcal · P {totals.protein} g · C {totals.carbs} g</span><small>Totals reflect only matching meals.</small></div>
    <div className={styles.actions}>{hasFilters && <button type="button" className={styles.secondary} onClick={() => { setSearch(""); setSort("new"); setFrom(""); setThrough(""); }}>Clear filters</button>}{totals.count > 0 && !invalidRange && !tooMany ? <a className={styles.export} href={historyExportHref(options)} download="Mealio-history.pdf">↓ Export shown meals · PDF</a> : <span className={styles.exportDisabled} aria-disabled="true">↓ Export shown meals · PDF</span>}</div>
    <p className={styles.privacy}>Private download · includes matching meals, source and uncertainty notes.</p>
    {visible.length ? <div className={styles.days}>{visible.map((group, index) => {
      const expanded = openDays[group.day] ?? index === 0;
      const contentsId = `${dayId}-${group.day}`;
      return <section className={styles.day} key={group.day}>
        <h3><button type="button" className={styles.dayToggle} aria-expanded={expanded} aria-controls={contentsId} onClick={() => setOpenDays((current) => ({ ...current, [group.day]: !expanded }))}><span><strong>{labelDay(group.day)}</strong><small>{group.meals.length} {group.meals.length === 1 ? "meal" : "meals"} · {group.totalKcal} kcal shown</small></span><span className={styles.chevron} aria-hidden="true">{expanded ? "⌄" : "›"}</span></button></h3>
        <div className={styles.dayBody} id={contentsId} hidden={!expanded}>{group.meals.map((meal) => <button type="button" className={styles.mealRow} key={meal.id} onClick={() => onOpenDetails(meal)}><span><strong>{meal.description}</strong><small>{timeFormatter.format(new Date(meal.eatenAt))} · P {meal.protein} g · C {meal.carbs} g</small>{meal.itemSnapshots.some((item) => !!item.uncertainty) && <small className={styles.uncertain}>Portion or recipe needs review</small>}</span><b>{meal.kcal} kcal</b></button>)}</div>
      </section>;
    })}</div> : <p className={styles.empty}>{groups.length ? "No matching meals. Clear a filter to see more." : "No meals logged yet."}</p>}
  </section>;
}
