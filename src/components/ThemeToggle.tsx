"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let next = false;
      try { next = localStorage.getItem("mealio-theme") === "dark"; } catch { /* Use the default theme. */ }
      setDark(next); document.documentElement.dataset.theme = next ? "dark" : "light";
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <button type="button" aria-label={`Switch to ${dark ? "light" : "dark"} mode`} onClick={() => {
    const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("mealio-theme", next ? "dark" : "light"); } catch { /* The active theme still works in memory. */ }
  }}>{dark ? "☀" : "☾"}</button>;
}
