import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";

const assets = readdirSync(".next/static", { recursive: true }).map(String).filter((name) => /\.(js|css|woff2?)$/.test(name)).sort().map((name) => `/_next/static/${name}`);
const version = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 16);
const pages = ["/nutrition", "/foods", "/foods/new", "/foods/recipes/new", "/foods/settings", "/foods/details", "/about", "/about/sources"];
// Root scope permits document navigation between public local-only pages. An
// explicit allowlist excludes the private journal, authentication and APIs.
const worker = `const CACHE = "mealio-nutrition-${version}";
const PAGES = ${JSON.stringify(pages)};
const ASSETS = ${JSON.stringify([...pages, "/nutrition/catalog.json", "/nutrition/openfoodfacts.json", "/nutrition/manifest.json", "/nutrition/ATTRIBUTION.md", ...assets])};
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("mealio-nutrition-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
 const url = new URL(event.request.url);
 if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
 if (event.request.mode === "navigate" && PAGES.includes(url.pathname)) {
   event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(url.pathname)))); return;
 }
 if (ASSETS.includes(url.pathname) && !PAGES.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
});
`;
writeFileSync("public/nutrition/sw.js", worker);
console.log(`Offline nutrition shell: ${assets.length} build assets, cache ${version}`);
