"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Document navigation uses the offline HTML cache; RSC navigation requires a network response. */

import { useEffect, useState, type ReactNode } from "react";
import ThemeToggle from "../ThemeToggle";
import OfflineCache from "./OfflineCache";
import styles from "./Library.module.css";
import dashboard from "../MealDashboard.module.css";

export default function LibraryShell({ title, subtitle, back = "/foods", backLabel = "My foods & recipes", children }: {
  title: string; subtitle?: string; back?: string | null; backLabel?: string; children: ReactNode;
}) {
  const [returnTo, setReturnTo] = useState("/");
  useEffect(() => {
    const frame = requestAnimationFrame(() => { try { if (sessionStorage.getItem("mealio-library-return") === "/nutrition") setReturnTo("/nutrition"); } catch { /* Default to journal. */ } });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <main className={styles.page}>
    <header className={styles.brand}><a className={styles.logo} href={returnTo} aria-label="Mealio home">Mealio<span>.</span></a><ThemeToggle /></header>
    <a className={styles.back} href={back ?? returnTo}><span aria-hidden="true">←</span> {back ? backLabel : returnTo === "/nutrition" ? "Back to estimator" : "Back to meal"}</a>
    <h1 className={styles.title}>{title}</h1>{subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    {children}
    <footer className={styles.footer}><OfflineCache /></footer>
    <nav className={dashboard.nav} aria-label="Main"><a href="/?screen=today">Today</a><a href="/?screen=entry" className={dashboard.add} aria-label="Add meal">+</a><a href="/?screen=history">History</a></nav>
  </main>;
}
