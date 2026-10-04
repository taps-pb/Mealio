import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";

const assets = readdirSync(".next/static", { recursive: true }).map(String).filter((name) => /\.(js|css|woff2?)$/.test(name)).sort().map((name) => `/_next/static/${name}`);
const version = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 16);
// This worker is scoped to the public local estimator. It never caches meal,
// auth, API responses or the private dashboard. Static bundles contain no keys.
const worker = `const CACHE = "mealio-nutrition-${version}";
const ASSETS = ${JSON.stringify(["/nutrition", "/nutrition/catalog.json", "/nutrition/openfoodfacts.json", "/nutrition/manifest.json", ...assets])};
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("mealio-nutrition-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
 const url = new URL(event.request.url);
 if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
 if (event.request.mode === "navigate" && url.pathname === "/nutrition") {
  event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match("/nutrition")))); return;
 }
 if (ASSETS.includes(url.pathname) && url.pathname !== "/nutrition") event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
});
`;
writeFileSync("public/nutrition/sw.js", worker);
console.log(`Offline nutrition shell: ${assets.length} build assets, cache ${version}`);
