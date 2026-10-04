import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { createNutritionEngine } from "../src/lib/nutrition/runtime";
import { realFoodCorpus } from "../src/lib/nutrition/corpus";

let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Offline benchmark"); };
const start = performance.now();
const engine = createNutritionEngine();
const indexBuildMs = performance.now() - start;
const cold: number[] = [], warm: number[] = [];
for (const text of realFoodCorpus) {
  const start = performance.now(); engine.estimate(text); cold.push(performance.now() - start);
}
for (let repeat = 0; repeat < 100; repeat++) for (const text of realFoodCorpus) {
  const start = performance.now(); engine.estimate(text); warm.push(performance.now() - start);
}
const stats = (measurements: number[]) => {
  const sorted = measurements.sort((a, b) => a - b);
  return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) };
};
const report = { node: process.version, platform: process.platform, architecture: process.arch, indexBuildMs, firstPass: stats(cold), cached: stats(warm), networkRequests: requests };
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--report")) writeFileSync("docs/nutrition-benchmark.json", JSON.stringify(report, null, 2) + "\n");
