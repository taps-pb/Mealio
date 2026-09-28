import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseImportArgs, readPrivateCatalog } from "./import-indb";

const recipe = { sourceId: "TEST001", name: "Synthetic roti", kcalPer100g: 200,
  proteinPer100g: 5, carbsPer100g: 20, servingUnit: "roti",
  servingKcal: 100, servingProtein: 2.5, servingCarbs: 10 };

describe("private catalog import gates", () => {
  it("requires deliberate confirmation and rejects unknown or repeated options", () => {
    expect(parseImportArgs([])).toBeNull();
    expect(parseImportArgs(["--replace"])).toBeNull();
    expect(parseImportArgs(["--confirm-private-upload", "--source", "other.json"])).toBeNull();
    expect(parseImportArgs(["--confirm-private-upload", "--confirm-private-upload"])).toBeNull();
    expect(parseImportArgs(["--confirm-private-upload"])).toEqual({ replace: false });
    expect(parseImportArgs(["--confirm-private-upload", "--replace"])).toEqual({ replace: true });
  });

  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true });
    root = undefined;
  });

  it("reads only a validated ignored-path export and rejects malformed or large files", async () => {
    root = await mkdtemp(join(tmpdir(), "mealio-private-import-"));
    expect(await readPrivateCatalog(root)).toBeNull();
    await mkdir(join(root, "dataset"));
    const file = join(root, "dataset", "indb-private.json");
    await writeFile(file, JSON.stringify([recipe]));
    expect(await readPrivateCatalog(root)).toEqual([recipe]);
    await writeFile(file, JSON.stringify([recipe, recipe]));
    expect(await readPrivateCatalog(root)).toBeNull();
    await writeFile(file, "not json");
    expect(await readPrivateCatalog(root)).toBeNull();
    await writeFile(file, " ".repeat(5_000_001));
    expect(await readPrivateCatalog(root)).toBeNull();
  });
});
