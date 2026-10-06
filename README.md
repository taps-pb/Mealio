# Mealio

Mobile-first meal tracker for one privately provisioned owner. Describe a meal, review itemized calorie/protein/carbohydrate estimates, correct them, save with an editable time, and browse daily history in the owner's timezone. There is no public signup or password-reset flow.

## Current status

- The hosted site is [mealio-two.vercel.app](https://mealio-two.vercel.app/). GitHub `main` automatically deploys to Vercel; PostgreSQL is hosted privately on Neon.
- Nutrition estimation now runs entirely on the device. No AI or nutrition API key is required. The private legacy INDB catalog remains isolated in Neon; it is not copied into the distributable local dataset.
- **Not yet cleared for real meal history:** the Neon snapshot taken before the catalog migration is a one-time rollback point, not a backup of future meals. Recurring backups with a tested restore, a full real-phone walkthrough (including editing and timezone boundaries), and final accessibility/security checks are still needed. Until then, use the hosted site for testing with dummy meals only.
- `/preview` is development-only sample data (404 in production), not private meal history. The planning and visual reference files live in the parent `plan/` folder, outside this Git repository.
- History supports search, date range and sort, with expandable day cards. The authenticated PDF export includes only matching meals, saved nutrient values, sources and uncertainty notes in the owner's timezone. A PDF is a readable report, **not** a database backup. The optional sideload-only Android wrapper is in `android/`; its APK and signing key are kept outside Git. An updated APK is required for saving PDF exports through the wrapper.

## How estimates work

The browser parses food text, resolves local names/aliases/restaurant variants, resolves food-specific portions and calculates nutrition from a bundled versioned catalog. Sources include selected USDA FNDDS/SR records, Open Food Facts products, defined Mealio recipes and cited official restaurant/manufacturer facts. There is **no remote fallback**. Unknown foods, unsupported portions and inconsistent labels ask for clarification. Recipe/portion assumptions remain explicit. Saved history retains its actual nutrition snapshot; new dataset versions do not recalculate old meals.

Open **`/nutrition` once while online** and wait for “Ready for offline use”. This caches the public estimator shell for offline reloads. Estimation itself never needs networking, including in the usual authenticated meal editor. Login, saving meals, history and PDFs retain their existing online behavior. The `/api/estimate` endpoint is retired (HTTP 410).

Use **My foods & recipes** to open the dedicated `/foods` library. Food creation, recipe creation and backup/reset controls have separate screens; the Add Meal editor keeps only current-meal estimation, corrections and review. The library persists in browser storage, is not uploaded, and is shared between `/nutrition` and the journal on that device. Clearing browser storage removes it. Existing reviewed meal corrections can be explicitly imported from loaded history through **Library settings**; nothing is silently copied or rewritten. Attribution is available under **About Mealio → Data sources & licenses**.

The public library screens are included in the offline shell. Unsaved meal text, nutrients, timestamps and temporary interpretations are preserved in tab-local session storage when visiting the library. See [library UI architecture and verification](docs/library-ui.md).

See [migration architecture, sources and build instructions](docs/offline-nutrition.md), [exact corpus interpretations](docs/nutrition-corpus.md), and [dataset attribution](public/nutrition/ATTRIBUTION.md).

Explicit owner-requested recalculation of existing history is available through the [private history re-estimation utility](scripts/README-history-reestimate.md). It updates nutrition in place after creating an encrypted reversible revision, verifies every original meal ID/date/description, and refuses unresolved all-meal migrations.

## Local development

Requires Node.js 20.11+ and PostgreSQL for the authenticated journal. Install with `npm ci`, put `DATABASE_URL` in a private `.env.local`, apply migrations, then run `npm run dev`. The standalone estimator and `npm run food:resolve -- "2 aloo pyaaz paratha"` need neither credentials nor a database. Nutrition API keys are no longer read by the application. Do not overwrite private environment files or expose credentials.

CLI tools do **not** automatically load `.env.local`: provide `DATABASE_URL` privately in their process environment. Run `npm run db:migrate` before first use. On a new database only, privately supply `ADMIN_USERNAME`, `ADMIN_PASSWORD` (at least 12 characters), and an IANA `ADMIN_TIMEZONE` such as `Asia/Kolkata`, then run `npm run provision-admin`. It refuses to create a second owner. The app has no public account creation or reset endpoint. For private recovery, supply `DATABASE_URL`, the existing `ADMIN_USERNAME`, and `ADMIN_NEW_PASSWORD`, then run `npm run recover-admin`; it rotates the password and revokes old sessions.

### Private INDB catalog

`dataset/` is Git-ignored, and the staged-secret hook blocks commits containing it. The owner approved private use of `Anuvaad_INDB_2024.11.xlsx`; a public bulk-redistribution licence for the workbook or derived catalog has not been established. **Never commit or bundle either file.** To audit the local workbook, install Python `openpyxl` separately and run `python3 scripts/prepare-indb.py`. To create the ignored JSON catalog after confirming rights, run `python3 scripts/prepare-indb.py --export dataset/indb-private.json --confirm-rights`. The export refuses invalid base nutrients and retains per-100g values when a serving is incomplete; the lookup rejects unsafe standard-serving assumptions.

The private importer remains optional historical/developer tooling: `npm run import-indb -- --confirm-private-upload`, with explicit rights and a private database connection. The local estimator never imports `src/server/nutrition/indb.ts`, contacts Neon, or reads `INDB_DATA_FILE` / `INDB_CATALOG_SOURCE`. No legacy catalog switch enables a runtime fallback. Existing private tables and historical snapshots are retained.

## Deployment and checks

The web app requires only `DATABASE_URL` (the **pooled** Neon URL). Remove obsolete hosted `FIREWORKS_API_KEY`, `USDA_API_KEY`, `USDA_KEY_FILE`, `INDB_DATA_FILE` and `INDB_CATALOG_SOURCE` settings when releasing this migration. Do not change credentials used by independent coding tools or private import scripts. Preview deployments must not access the production database. `ADMIN_PASSWORD` is private one-time CLI input, not a Vercel setting. Meal APIs still require owner authentication.

Run `npm test`, `python3 -m unittest scripts/test_prepare_indb.py scripts/test_food_imports.py`, `npm run food:validate`, `npm run lint`, `npm run typecheck`, and `npm run build`. Then `npx playwright install chromium` (once) and `npm run test:browser` exercise the production offline cache, correction/recipe persistence and journal integration with synthetic API fixtures. `postbuild` creates the versioned service worker. An installed pre-commit hook runs `tools/scan_staged_secrets.py`.

Run `npm run food:resolve -- "30 g Chocos + 200 ml milk"`, `npm run food:benchmark`, and `npm run food:corpus` for local diagnostics. These disable networking. Live-provider QA has been replaced by offline regression tests.

Before using the site for real history, arrange recurring offsite database backups and verify a restore; then complete login → estimate → correct → save → history → edit → delete and logout on a real phone, including ambiguous/missing portions, local-day boundaries, and accessibility. Do not treat a successful build or a single snapshot as those release checks.

The development-only Fireworks coding-worker bridge in `opencode.json` is unrelated to nutrition estimation. Its separate private credential remains outside this repository; the offline application never imports the bridge.
