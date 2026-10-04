import { performance } from "node:perf_hooks";
import { createNutritionEngine } from "../src/lib/nutrition/runtime";

let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Network disabled in offline resolver"); };
const engine = createNutritionEngine();
const text = process.argv.slice(2).join(" ") || "2 aloo pyaaz paratha little oil";
const start = performance.now();
const result = engine.estimate(text);
console.log(JSON.stringify({ ...result, elapsedMs: performance.now() - start, networkRequests: requests }, null, 2));
