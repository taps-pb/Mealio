# Mealio

Mobile-first meal tracker for one privately provisioned owner. Describe a meal, review itemized calorie/protein/carbohydrate estimates, correct them, save with an editable time, and browse daily history in the owner's timezone. There is no public signup or password-reset flow.

## Current status

- The test deployment is at [mealio-two.vercel.app](https://mealio-two.vercel.app/). GitHub `main` automatically deploys to Vercel; PostgreSQL is hosted privately on Neon. Owner login/logout and live INDB estimates for roti and paneer have been reported working. The latest qualified kaju-sweet aliases were verified locally and deployed but still need owner confirmation on the live site.
- A private INDB catalog was imported into Neon and enabled through the Production-only `INDB_CATALOG_SOURCE=database` setting. The workbook and derived JSON remain outside Git and the deployed filesystem. Local tests also cover the complete estimate → save → history → delete journey with synthetic credentials.
- **Not yet cleared for real meal history:** the Neon snapshot taken before the catalog migration is a one-time rollback point, not a backup of future meals. Recurring backups with a tested restore, a full real-phone walkthrough (including editing and timezone boundaries), and final accessibility/security checks are still needed. Until then, use the hosted site for testing with dummy meals only.
- `/preview` is development-only sample data (404 in production), not private meal history. The planning and visual reference files live in the parent `plan/` folder, outside this Git repository.
- History supports search, date range and sort, with expandable day cards. The authenticated PDF export includes only matching meals, saved nutrient values, sources and uncertainty notes in the owner's timezone. A PDF is a readable report, **not** a database backup. The optional sideload-only Android wrapper is in `android/`; its APK and signing key are kept outside Git. An updated APK is required for saving PDF exports through the wrapper.

## How estimates work

The server uses Fireworks to itemize foods and portions, **not** to invent nutrient values. For a unique, exact Indian-dish match, a privately stored INDB reference recipe is tried first; otherwise Mealio tries USDA FoodData Central and then requests manual values. Every source is shown for review. Estimates, especially recipe composition and standard serving sizes, are uncertain until the owner confirms them. Saved nutrition is a snapshot, so later catalog changes do not rewrite old meals; re-estimation is explicit and never silently replaces manual corrections.

INDB accepts a known weight or a compatible count/serving. Qualified alternate names in parentheses can match exactly when unambiguous. For example, **“2 pieces kaju katli”** and **“50 g kaju burfi”** can use the same reference recipe, while **“kaju katli”** without an amount asks for a portion. Generic **“burfi”** does not pick one of several different sweets. Counted roti can use a standard chapati serving; a curry without a bowl count or measured weight cannot assume one. Source and portion warnings remain visible even when a nutrient candidate is returned.

## Local development

Requires Node.js 20.11+ and PostgreSQL. In a fresh checkout, install dependencies with `npm install`, create a private `.env.local` (do not overwrite one already in use), and supply `DATABASE_URL` and `FIREWORKS_API_KEY` there for the web app. For USDA, set `USDA_API_KEY` or supply a private key file via `USDA_KEY_FILE`; locally the server otherwise looks for `../.secrets/usda_api.txt`. Do not commit or paste credentials into logs or shell history. Run `npm run dev` after applying migrations.

CLI tools do **not** automatically load `.env.local`: provide `DATABASE_URL` privately in their process environment. Run `npm run db:migrate` before first use. On a new database only, privately supply `ADMIN_USERNAME`, `ADMIN_PASSWORD` (at least 12 characters), and an IANA `ADMIN_TIMEZONE` such as `Asia/Kolkata`, then run `npm run provision-admin`. It refuses to create a second owner. The app has no public account creation or reset endpoint. For private recovery, supply `DATABASE_URL`, the existing `ADMIN_USERNAME`, and `ADMIN_NEW_PASSWORD`, then run `npm run recover-admin`; it rotates the password and revokes old sessions.

### Private INDB catalog

`dataset/` is Git-ignored, and the staged-secret hook blocks commits containing it. The owner approved private use of `Anuvaad_INDB_2024.11.xlsx`; a public bulk-redistribution licence for the workbook or derived catalog has not been established. **Never commit or bundle either file.** To audit the local workbook, install Python `openpyxl` separately and run `python3 scripts/prepare-indb.py`. To create the ignored JSON catalog after confirming rights, run `python3 scripts/prepare-indb.py --export dataset/indb-private.json --confirm-rights`. The export refuses invalid base nutrients and retains per-100g values when a serving is incomplete; the lookup rejects unsafe standard-serving assumptions.

For local file mode, set server-side `INDB_DATA_FILE` to the absolute path of that JSON in ignored `.env.local`. For serverless production, first take a database backup, run the additive migration using the **direct** Neon URL, and run `npm run import-indb -- --confirm-private-upload` locally with that direct URL as `DATABASE_URL`. This importer reads only `dataset/indb-private.json`, validates the whole catalog, and refuses to overwrite an existing row unless explicitly given `--replace`; it prints neither records nor credentials. The import has already been completed for the current Neon project. To enable database lookup, set **Production-only** `INDB_CATALOG_SOURCE=database` on Vercel and redeploy. Without that setting, the production app uses USDA/manual fallback. Never place `INDB_DATA_FILE` or catalog data in Vercel environment variables.

## Deployment and checks

Vercel Production variables: `DATABASE_URL` (the **pooled** Neon URL), `FIREWORKS_API_KEY`, `USDA_API_KEY`, and `INDB_CATALOG_SOURCE=database`. Keep database credentials and API keys secret and do not give preview deployments access to the production database. `ADMIN_PASSWORD` is for the private one-time CLI only, not Vercel. Environment-variable changes require a redeployment; pushes to GitHub `main` automatically create production deployments. The public URL displays a login page, but meal APIs require owner authentication.

Run `npm test`, `python3 -m unittest scripts/test_prepare_indb.py`, `npm run lint`, `npm run typecheck`, and `npm run build` before pushing. The latest local run passed **68 Vitest tests and 7 Python audit tests**, lint, typecheck and build. An installed pre-commit hook runs `tools/scan_staged_secrets.py` and blocks commits containing private dataset files or common credentials.

Before using the site for real history, arrange recurring offsite database backups and verify a restore; then complete login → estimate → correct → save → history → edit → delete and logout on a real phone, including ambiguous/missing portions, local-day boundaries, and accessibility. Do not treat a successful build or a single snapshot as those release checks.

The development-only Fireworks coding-worker bridge in `opencode.json` reads its key from `../.secrets/fw_api.txt` at runtime (or a private `FIREWORKS_KEY_FILE` path). It is unrelated to the hosted app's `FIREWORKS_API_KEY`.
