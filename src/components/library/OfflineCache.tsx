"use client";

import { useEffect, useState } from "react";

export default function OfflineCache() {
  const [status, setStatus] = useState("Preparing offline pages…");
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let alive = true;
    (async () => {
      // Replace the old estimator-only scope with one allowlisted public shell.
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (new URL(registration.scope).pathname === "/nutrition") await registration.unregister();
      }
      const registration = await navigator.serviceWorker.register("/nutrition/sw.js", { scope: "/" });
      if (registration.installing || registration.waiting || !registration.active) await new Promise<void>((resolve, reject) => {
        const worker = registration.installing ?? registration.waiting;
        if (!worker) { reject(new Error("No offline worker")); return; }
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
          if (worker.state === "redundant") reject(new Error("Offline installation failed"));
        });
      });
      if (alive) setStatus("Ready for offline use on this device.");
    })().catch(() => { if (alive) setStatus("Local estimation is available. Offline page caching needs a production build and an initial connection."); });
    return () => { alive = false; };
  }, []);
  return <p role="status">{status}</p>;
}
