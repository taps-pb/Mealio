"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Library.module.css";

export default function ConfirmDialog({ title, children, action = "Delete", onCancel, onConfirm, busy = false }: {
  title: string; children: ReactNode; action?: string; onCancel: () => void; onConfirm: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id={id}>{title}</h2><div>{children}</div><div className={styles.actions}>
      <button className={styles.button} type="button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
      <button className={styles.danger} type="button" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : action}</button>
    </div>
  </dialog>;
}
