"use client";

import { useCallback, useEffect, useState } from "react";
import LoginForm from "./LoginForm";
import MealDashboard from "./MealDashboard";

type State =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" }
  | { kind: "authenticated"; username: string; timezone: string };

export default function AuthGate() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const check = useCallback(() => { setState({ kind: "loading" }); setRetry((value) => value + 1); }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem("mealio-theme") === "dark" ? "dark" : "light";
    const controller = new AbortController();
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { setState({ kind: "unauthenticated" }); return; }
        if (!response.ok) { setState({ kind: "unavailable" }); return; }
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (data && typeof data === "object" && "username" in data && "timezone" in data &&
            typeof data.username === "string" && typeof data.timezone === "string") {
          setState({ kind: "authenticated", username: data.username, timezone: data.timezone });
        } else setState({ kind: "unavailable" });
      }).catch(() => { if (!controller.signal.aborted) setState({ kind: "unavailable" }); });
    return () => controller.abort();
  }, [retry]);

  if (state.kind === "loading") return <main role="status" aria-live="polite" style={{ padding: 24 }}>Loading Mealio…</main>;
  if (state.kind === "unauthenticated") return <LoginForm onSuccess={check} />;
  if (state.kind === "unavailable") return <main role="alert" style={{ padding: 24 }}><p>Service temporarily unavailable.</p><button type="button" onClick={check}>Retry</button></main>;
  return <MealDashboard username={state.username} timezone={state.timezone} onLogout={() => setState({ kind: "unauthenticated" })} />;
}
