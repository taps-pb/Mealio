"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatCalories } from "@/lib/formatCalories";
import styles from "./MealRing.module.css";
import { ringColorIndices } from "./ringColors";
import { spreadRingMarkerAngles } from "./ringMarkerAngles";

export type RingMeal = { id: string; name: string; kcal: number };
const CIRC = 2 * Math.PI * 88;
const HEIGHT = 252;
const colors = [
  "var(--color-arc-primary)",
  "var(--color-arc-secondary)",
  "var(--color-arc-tertiary)",
  "var(--color-arc-quaternary)",
];

function pointOnCurve(t: number, start: { x: number; y: number }, end: { x: number; y: number }) {
  return {
    x: (1 - t) ** 2 * start.x + (1 - (1 - t) ** 2) * end.x,
    y: (1 - t * t) * start.y + t * t * end.y,
  };
}

function capAt(radius: number, cx: number, cy: number, start: { x: number; y: number }, end: { x: number; y: number }) {
  const distance = (t: number) => {
    const p = pointOnCurve(t, start, end);
    return Math.hypot(p.x - cx, p.y - cy);
  };
  let before = 0;
  for (let step = 1; step <= 80; step++) {
    const after = step / 80;
    if (distance(before) < radius && distance(after) >= radius) {
      let low = before, high = after;
      for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        if (distance(mid) < radius) low = mid;
        else high = mid;
      }
      const p = pointOnCurve((low + high) / 2, start, end);
      const angle = Math.atan2(p.y - cy, p.x - cx);
      const spread = 5 / radius;
      const from = { x: cx + radius * Math.cos(angle - spread), y: cy + radius * Math.sin(angle - spread) };
      const to = { x: cx + radius * Math.cos(angle + spread), y: cy + radius * Math.sin(angle + spread) };
      return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}`;
    }
    before = after;
  }
  return null;
}

export default function MealRing({ meals }: { meals: RingMeal[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const maskId = useId().replaceAll(":", "");
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  const positive = meals.filter((meal) => Number.isFinite(meal.kcal) && meal.kcal > 0);
  const total = positive.reduce((sum, meal) => sum + meal.kcal, 0);
  const displayTotal = formatCalories(total);
  const colorSlots = ringColorIndices(positive.length);
  const parts = positive.map((meal, index) => {
    const start = positive.slice(0, index).reduce((distance, previous) => distance + previous.kcal / total * CIRC, 0);
    const share = meal.kcal / total * CIRC;
    const gap = Math.min(24, share * .28);
    const angle = (start + share / 2) / CIRC * 2 * Math.PI;
    const part = { meal, color: colors[colorSlots[index]], angle, dash: Math.max(1, share - gap), offset: -(start + gap / 2) };
    return part;
  });
  const selected = parts.find((part) => part.meal.id === selectedId) ?? parts[0];
  const ringSize = Math.min(220, width * .72);
  const scale = ringSize / 220;
  const cx = width / 2, cy = HEIGHT / 2;
  const markerAngles = spreadRingMarkerAngles(parts.map((part) => part.angle), 67 * scale);
  const dots = parts.map((part, index) => ({
    ...part,
    x: cx + Math.sin(markerAngles[index]) * 67 * scale,
    y: cy - Math.cos(markerAngles[index]) * 67 * scale,
    displaced: Math.abs(markerAngles[index] - part.angle) > .01,
    arcX: cx + Math.sin(part.angle) * 78 * scale,
    arcY: cy - Math.cos(part.angle) * 78 * scale,
  }));
  const active = dots.find((dot) => dot.meal.id === selected?.meal.id);
  const right = active ? active.x >= cx : true;
  const top = active ? active.y < cy : true;
  const labelWidth = Math.min(96, Math.max(70, (width - ringSize) / 2 + 35));
  const labelHeight = 48;
  const end = active ? {
    x: right ? Math.max(active.x + 12, width - labelWidth) : Math.min(active.x - 12, labelWidth),
    y: top ? labelHeight / 2 : HEIGHT - labelHeight / 2,
  } : null;
  const from = active ? { x: active.x, y: active.y } : null;
  const color = active ? active.color : colors[0];

  return <div className={styles.stage} ref={stage} aria-label={`Calories by meal, ${displayTotal} kcal total`}>
    <div className={styles.ring} style={{ width: ringSize, height: ringSize }}>
      <svg className={styles.art} viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r="105" fill="none" stroke="var(--color-ring-guide)" strokeWidth="2" strokeDasharray="1 10" strokeLinecap="round" />
        <circle cx="110" cy="110" r="88" fill="none" stroke="var(--color-ring-track)" strokeWidth="16" />
        <g transform="rotate(-90 110 110)">{parts.map((part) => <circle key={part.meal.id} cx="110" cy="110" r="88" fill="none" stroke={part.color} strokeWidth="16" strokeLinecap={part.dash > 24 ? "round" : "butt"} strokeDasharray={`${part.dash} ${CIRC}`} strokeDashoffset={part.offset} />)}</g>
      </svg>
      <div className={styles.center}><strong style={{ "--calorie-width": Math.max(1, displayTotal.length * .64) } as React.CSSProperties}>{displayTotal}</strong><span>kcal eaten</span></div>
    </div>
    {width > 0 && active && from && end && <svg className={styles.leader} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
      <defs><mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width={width} height={HEIGHT} fill="white" /><circle cx={cx} cy={cy} r={88 * scale} fill="none" stroke="black" strokeWidth={26 * scale} /></mask></defs>
      {dots.filter((dot) => dot.displaced).map((dot) => <path key={dot.meal.id} d={`M ${dot.x} ${dot.y} L ${dot.arcX} ${dot.arcY}`} fill="none" stroke={dot.color} strokeWidth="1.5" opacity=".8" />)}
      <path d={`M ${from.x} ${from.y} Q ${end.x} ${from.y} ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" mask={`url(#${maskId})`} />
      {[75, 101].map((r) => {
        const path = capAt(r * scale, cx, cy, from, end);
        return path && <path key={r} d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />;
      })}
      <path d={right ? `M ${end.x - 5} ${end.y - 3} L ${end.x} ${end.y} L ${end.x - 5} ${end.y + 3}` : `M ${end.x + 5} ${end.y - 3} L ${end.x} ${end.y} L ${end.x + 5} ${end.y + 3}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>}
    {dots.map((dot) => <button key={dot.meal.id} type="button" className={styles.dot} style={{ left: dot.x, top: dot.y, background: dot.color }} aria-label={`Show ${dot.meal.name}, ${formatCalories(dot.meal.kcal)} calories`} aria-pressed={dot.meal.id === selected?.meal.id} onClick={() => setSelectedId(dot.meal.id)} />)}
    {active && <div className={`${styles.callout} ${right ? styles.right : styles.left} ${top ? styles.top : styles.bottom}`} style={{ width: labelWidth }} aria-live="polite"><strong>{active.meal.name}</strong><small>· {formatCalories(active.meal.kcal)} kcal</small></div>}
  </div>;
}
