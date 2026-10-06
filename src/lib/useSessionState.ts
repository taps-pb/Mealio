"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

/** Tab-local drafts survive full-document navigation and offline back/reload. */
export function useSessionState<T>(key: string, initial: T, accept: (value: unknown) => value is T) {
  const initialRef = useRef(initial), acceptRef = useRef(accept);
  const [state, setState] = useState({ value: initial, ready: false });
  const current = useRef(state.value);
  useEffect(() => { current.current = state.value; }, [state.value]);
  useEffect(() => {
    const restore = () => {
      let value = initialRef.current;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) { const parsed: unknown = JSON.parse(raw); if (acceptRef.current(parsed)) value = parsed; }
      } catch { /* Keep an in-memory draft if tab storage is unavailable. */ }
      current.current = value;
      setState({ value, ready: true });
    };
    const frame = requestAnimationFrame(restore);
    const revisit = (event: PageTransitionEvent) => { if (event.persisted) restore(); };
    window.addEventListener("pageshow", revisit);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pageshow", revisit); };
  }, [key]);
  const persist = useCallback(() => {
    try { sessionStorage.setItem(key, JSON.stringify(current.current)); return true; }
    catch { return false; }
  }, [key]);
  useEffect(() => { if (state.ready) persist(); }, [state, persist]);
  useEffect(() => {
    const flush = () => { if (state.ready) persist(); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [state.ready, persist]);
  const setValue = useCallback((next: SetStateAction<T>) => setState((previous) => ({ ...previous,
    value: typeof next === "function" ? (next as (value: T) => T)(previous.value) : next })), []);
  const clear = useCallback(() => {
    current.current = initialRef.current;
    setState({ value: initialRef.current, ready: true });
    try { sessionStorage.removeItem(key); } catch { /* The in-memory draft is still cleared. */ }
  }, [key]);
  return { value: state.value, setValue, ready: state.ready, persist, clear };
}
