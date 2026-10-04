# Offline nutrition migration

## Audit (before implementation, 2026-10-04)

`MealDashboard.estimate()` sends the owner's description to `/api/estimate`.
That authenticated route first tries the small `simple-parser.ts` ingredient
grammar; otherwise `interpret.ts` sends the text to Fireworks DeepSeek. Each
item is resolved through Postgres correction/cache tables, private INDB, then
live USDA search and detail requests. Misses can invoke `recipe.ts` (LLM
ingredient weights), `fallback.ts` (LLM missing ingredients/whole-dish macros),
and a small hand-entered approximation dictionary. Fat may be inferred from
energy. Results are arrays of editable `MealItemSnapshot`s plus summed totals.

Runtime estimation credentials: `FIREWORKS_API_KEY`, `USDA_API_KEY`,
`USDA_KEY_FILE`; private catalog switches: `INDB_DATA_FILE`,
`INDB_CATALOG_SOURCE`. The coding-worker MCP bridge is independent tooling.

Existing useful infrastructure: local ingredient aliases, cautious identity
checks, macro plausibility checks, explicit uncertainty, owner-reviewed saves,
JSONB nutrition snapshots and timezone grouping. Postgres `meals` stores
numeric(10,2) totals; `itemSnapshots` preserve source and portion evidence.
`portion_preferences` remembers only grams/unit after confirmed saves;
`nutrition_cache` holds resolved reference snapshots. No persistent custom-food
or recipe editor exists. Existing tests cover parser, USDA, INDB, recipes,
fallbacks, cache, meal validation and the estimate route. Migrations 0000–0004
cover auth, meals, INDB and nutrition caches. History must not be recalculated.

## Migration design

Estimation runs in the browser (and the same pure engine in the CLI), not in a
server route that depends on Neon authentication. A compact, versioned,
multi-source catalog is bundled with the estimator. Exact aliases, barcodes,
restaurant variants and trigram postings are indexed locally. Quantity parsing,
food-specific portions, dimension-aware conversion and recipe arithmetic are
separate deterministic stages. Unknown identities or unsupported portions
return candidates and a clarification reason, never an external fallback.

User foods, recipes, mappings and portion corrections live in versioned browser
storage and can be exported/imported. Dataset and user revision identify engine
caches. Stored historical meals retain snapshots; only explicit new estimation
uses the current database. Meal history/login remain the existing online app.

## Source review

- USDA: public-domain/CC0, official FDC download and license reviewed.
- Sangat: repository `akashthawaitcc/sangat-food-db`, tree
  `d570685d8d5dc8351d8ff096c7867cce4d61e97f` reviewed, including LICENSE and data
  tree. LICENSE is CC BY-SA 4.0 but the snapshot has only one dish (not the
  advertised 200), and declares IFCT ingredient derivation while asserting
  public-domain status without evidence of upstream permission. Excluded from
  the default distribution pending upstream-rights verification.
- INDB/IFCT: existing private records are not copied into the browser or public
  catalog. Legacy private importer remains isolated developer tooling.
- Open Food Facts: database ODbL 1.0, individual contents DbCL; no images.
  Derived packaged-food layer and transformations are published separately with
  attribution and download access, without authentication.
- Restaurant values: only explicit official nutrition facts; unsupported items
  are recognizable catalog entries with unavailable nutrition.

## Implemented pipeline

`MealDashboard` / public `/nutrition` → `LocalEstimator` → `parseMeal` →
`NutritionEngine` → indexed `FoodCatalog` → food-specific portion/density →
`scaleNutrition` / cached recipe ingredient sums → editable snapshots.

- `src/lib/nutrition/`: pure browser-compatible parsing, matching, arithmetic,
  validation, library persistence, snapshots and bundled catalog entry point.
- Exact owner mappings and aliases outrank public aliases. Barcodes and
  restaurant variants are distinct from portion mass. Local trigram postings
  produce a bounded shortlist; edit/token similarity only autoaccepts strong,
  separated generic matches. Brand/restaurant misses produce candidates.
- Recipes have ingredient basis, preparation notes, explicit cooked yield and
  version. Only a defined recipe changes oil quantities. Unmodeled modifiers
  remain visible and lower confidence rather than inventing adjustments.
- Unknown identity, price-only size, unsupported dimensions/household portions
  and quarantined source nutrients produce no nutrition. Incomplete meals have
  no misleading full total. Owners can choose a local candidate or define a food.
- Browser `localStorage` key `mealio-food-library-v1:owner` stores validated,
  versioned foods, recipes and mappings; revision changes rebuild the engine and
  invalidate its cache. Writes fail visibly on quota/corruption errors. Export,
  import, mapping removal, dependency-safe food removal and reset are available.
- Count-only custom foods retain a serving basis; grams are never fabricated.
  A 1-piece custom biscuit scales to 10 pieces but cannot silently accept grams.
- Existing confirmed manual/portion corrections can be explicitly imported from
  already-loaded meal snapshots. Legacy server cache entries are not promoted to
  owner corrections. No database rewrite/migration is required: historical JSONB
  snapshots remain valid. New snapshots include original and normalized text,
  food ID, source record/version/license, dataset version, resolution method,
  confidence, portion basis/amount and recipe version. Internal precision is
  retained; existing reviewed meal totals still use their numeric(10,2) boundary.

### Remote-path removal

- `/api/estimate` no longer reads food text or performs authentication/database
  calls; it returns HTTP 410 directing old clients to refresh.
- Removed DeepSeek food interpretation from `interpret.ts` (only the legacy
  `InterpretedItem` type remains for isolated private tooling).
- Deleted `recipe.ts` AI ingredient construction, `fallback.ts` AI missing-food
  and whole-dish nutrient estimates, and `usda.ts` live search/detail client.
- Removed runtime key requirements from `.env.example` and deployment guidance;
  removed live-provider QA and replaced it with local regression tests. There was
  no AI SDK dependency to remove. The independent coding-worker MCP bridge is
  not imported by the app and retains its own private credential.
- Before releasing, remove obsolete hosted estimator variables described in
  README. This checkout change does not itself edit the hosting account.

### Offline entry/reload

The usual meal editor estimates entirely locally. The journal still uses its
existing authenticated online login/history/save/PDF routes. For offline startup,
visit `/nutrition` once online and wait for its ready message. Its narrowly
scoped service worker caches the public HTML/static code/catalog, never auth or
meal APIs. `npm run build` generates a build-versioned worker in `postbuild`.
The standalone page needs no account connection; its private library remains on
that browser. A fresh device must first obtain the application assets, as with
any installed offline application.

## Dataset build and extension

Raw public sources go in ignored `data/raw/`; private INDB remains in its separate
ignored location. Only reviewed normalized fields, small recipe/fact definitions,
and the runtime artifact are distributed.

```sh
# Normal build: fully offline from committed reviewed inputs
npm ci
npm run food:build
npm run food:validate

# Refresh public sources at development/build time only:
# obtain the exact official ZIPs listed in data/manifests/food-db.json, then
python3 scripts/import-usda.py data/raw/fndds.zip data/raw/sr.zip

# Stream an official OFF JSONL dump; .gz is supported without loading it all.
python3 scripts/import-openfoodfacts.py /path/to/openfoodfacts.jsonl.gz
# Or refresh just the explicitly selected seed barcodes:
python3 scripts/import-openfoodfacts.py --seed
npm run food:build

# Explain a phrase without network access
npm run food:resolve -- "2 aloo pyaaz paratha little oil"
npm run food:corpus
npm run food:benchmark
```

Selection is explicit in `data/selection.json`. Review the retrieval date,
label basis, variants and nutrient anomalies on each source refresh; then commit
the normalized changes and generated manifest/artifacts together. The OFF seed
was used because the country dump export returned HTTP 503; it is an actual
12-product build-time snapshot, not a claim to contain a national dump. Both
importers reject missing selected IDs and retain source identity/serving facts.
Same inputs reproduce the same artifact/version: no current-time/random data is
used in the build. `generatedAt` is the declared source snapshot date, not an
unrepeatable build clock. The database version hashes the content and metadata.

Add recipes in `data/recipes.json`; all ingredient IDs must exist. Add restaurant
facts/variants in `data/restaurant-facts.json`; the resolver needs no restaurant-
specific code changes. Source URL, actual fact-excerpt rights/license status,
retrieval date and source checksum are mandatory review inputs. No restricted
IFCT/INDB data should enter the default selection.

## Measured release artifact

Database **1-d6bd010519cf7374**. Runtime sizes below include each layer's foods,
aliases, portions and recipes, excluding shared manifest overhead.

| Source | Version | Rights/license | Records | Runtime bytes | Purpose |
|---|---|---|---:|---:|---|
| USDA FNDDS | 2021–2023 / 2024-10-31 | CC0 | 16 | 17,626 | Foods as consumed and portions |
| USDA SR Legacy | 2018-04 | CC0 | 18 | 14,821 | Fruits and recipe ingredients |
| Open Food Facts | 2026-10-04 snapshot + reviewed labels v1 | ODbL / DbCL | 12 | 13,761 | Packaged products |
| Subway India | August 2026 | Cited factual excerpt; original document copyrighted | 4 | 5,485 | 15/30 cm Paneer Tikka, Crispers, cookie |
| Coca-Cola India | Retrieved 2026-10-04 | Cited factual excerpt; original site copyrighted | 1 | 882 | Sprite volume label |
| Mealio | Recipe version 1 | CC0 definitions; ingredient licenses retained | 15 | 27,055 | Explicit Indian/drink recipes |

Totals: **66 foods, 152 aliases, 60 portions, 15 recipes, 13 packaged products,
4 restaurant items**. Downloaded source artifacts total **19,335,175 bytes**;
reviewed normalized inputs **74,967 bytes**; runtime catalog **82,207 bytes**;
gzipped catalog **12,440 bytes**. See `data/manifests/food-db.json` for exact
source URLs, checksums, counts and transformation scripts.

One selected Uncle Chipps API record has 120 g of macros per 100 g. A direct
review of its packaging photograph established the valid per-100-g values; the
explicit evidence/checksum in `data/reviewed-labels.json` supersedes the invalid
API profile. Jim Jam's India label likewise establishes 12.5 g per biscuit. The
selected OFF Sprite snapshot declares mass-based data; it is not relabeled as
volume. The independently cited official India label is preferred for Sprite
volume requests. Chocos defaults explicitly to the selected Moons and Stars
variant and warns to confirm it. Generic masala chips, an unspecified Cornitos
small bag, cooked plates of dry-label Maggi, Jimmy Jam and price-only Dairy Milk
need product/portion information or owner teaching. Owner-confirmed mappings for
history recalculation are supplied privately rather than baked into public aliases.
No dataset is presented as
a universal food reference.

The [exact corpus report](nutrition-corpus.md) contains all 25 original phrases,
parsed quantities, matched IDs, portions, sources, confidence and computed macros.

## Verification

See `nutrition-verification.md` for executed commands/results. Regression tests
block fetch, XMLHttpRequest, WebSocket, EventSource, Node HTTP(S) and sockets.
Browser integration uses synthetic meal APIs, never the owner's database. Source
inspection additionally checks for residual estimator network clients/keys.
