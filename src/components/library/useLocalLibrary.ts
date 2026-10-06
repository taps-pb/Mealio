"use client";

import { useCallback, useEffect, useState } from "react";
import { foodCatalog } from "@/lib/nutrition/runtime";
import { UserLibrary } from "@/lib/nutrition/user-library";
import { emptyUserData, type UserData } from "@/lib/nutrition/types";

export const localLibrary = () => new UserLibrary(window.localStorage, "owner", foodCatalog);
const changed = "mealio-library-changed";
export function useLocalLibrary() {
  const [user, setUser] = useState<UserData>(emptyUserData);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const reload = useCallback(() => {
    try { setUser(localLibrary().load()); setReady(true); setError(""); }
    catch (cause) { setReady(false); setError(cause instanceof Error ? cause.message : "Could not load your food library."); }
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(reload);
    window.addEventListener("storage", reload); window.addEventListener(changed, reload); window.addEventListener("pageshow", reload);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", reload); window.removeEventListener(changed, reload); window.removeEventListener("pageshow", reload); };
  }, [reload]);
  function update(change: (current: UserData) => UserData) {
    const saved = localLibrary().save(change(localLibrary().load()));
    setUser(saved); window.dispatchEvent(new Event(changed)); return saved;
  }
  function notify() { reload(); window.dispatchEvent(new Event(changed)); }
  return { user, ready, error, update, notify };
}

export function clearEstimatorDrafts() {
  for (const key of Object.keys(sessionStorage)) if (key.startsWith("mealio-estimator:")) sessionStorage.removeItem(key);
}
