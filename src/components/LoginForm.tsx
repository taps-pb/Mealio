"use client";

import { useId, useState, type FormEvent } from "react";
import styles from "./LoginForm.module.css";

export default function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const usernameId = useId(), passwordId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify({ username, password }),
      });
      setPassword("");
      if (!response.ok) { setError("Unable to sign in. Check your credentials or try later."); return; }
      onSuccess();
    } catch {
      setPassword("");
      setError("Unable to sign in. Check your credentials or try later.");
    } finally {
      setPending(false);
    }
  }

  return <main className={styles.wrapper}>
    <section className={styles.card} aria-labelledby="login-title">
      <span className={styles.eyebrow}>YOUR MEAL JOURNAL</span>
      <h1 id="login-title">Mealio<span>.</span></h1>
      <p>Private owner sign-in</p>
      <form onSubmit={submit}>
        <label htmlFor={usernameId}>Username</label>
        <input id={usernameId} name="username" autoComplete="username" required minLength={3} maxLength={64} disabled={pending} value={username} onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor={passwordId}>Password</label>
        <input id={passwordId} name="password" type="password" autoComplete="current-password" required disabled={pending} value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  </main>;
}
