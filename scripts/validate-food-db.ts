import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateCatalog } from "../src/lib/nutrition/validate";
import { foodCatalog } from "../src/lib/nutrition/runtime";

const report = validateCatalog(foodCatalog);
const manifest = JSON.parse(readFileSync("data/manifests/food-db.json", "utf8"));
if (createHash("sha256").update(readFileSync("public/nutrition/catalog.json")).digest("hex") !== manifest.sha256) report.errors.push("Artifact checksum differs from manifest");
console.log(JSON.stringify({ ...report, counts: manifest.counts, sizes: manifest.sizes }, null, 2));
if (report.errors.length) process.exitCode = 1;
