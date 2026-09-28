# Mealio

Mobile-first, single-owner meal tracker. Planning and visual references stay in the parent `plan/` directory outside this Git repository.

**Status:** the private dashboard, authentication, migrations, and meal APIs passed local PostgreSQL/browser checks with dummy credentials. Live Fireworks interpretation and a USDA lookup using a private key have been verified locally. Deployment and device-level verification remain outstanding. `/preview` contains sample data only in development (404 in production) and is not private meal history. Do not deploy or use for real meal history until the remaining release checks pass.

## Local development

Use Node 20.11+ and PostgreSQL. Copy `.env.example` to `.env.local` and provide private values for `DATABASE_URL` and `FIREWORKS_API_KEY`. For USDA, the server reads `USDA_API_KEY` from the environment first; if unset or empty, it reads `../.secrets/usda_api.txt` at runtime. The file may contain a raw key or one `USDA_API_KEY=...` line. Set `USDA_KEY_FILE` if the file lives elsewhere. Keep the file outside the repo with owner-only permissions; set a private `USDA_API_KEY` environment value in deployment instead. Next loads `.env.local` for the web app; the migration and provisioning CLIs require `DATABASE_URL` in their own process environment. Do not commit credentials. Run `npm install`, `npm run db:migrate` with `DATABASE_URL` set, then `npm run dev`. Privately set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_TIMEZONE` (IANA name) and run `npm run provision-admin` once with `DATABASE_URL` set. Provisioning refuses existing accounts; do not put these values in shell history or commit them. No signup endpoint exists.

Private recovery: in an authorized environment set `DATABASE_URL`, the existing `ADMIN_USERNAME`, and a new `ADMIN_NEW_PASSWORD`, then run `npm run recover-admin`. This rotates the password and invalidates all existing sessions atomically. There is no public reset endpoint. Never paste credentials into a committed file.

Checks: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Focus one test with `npx vitest run path/to/file.test.ts`.

The Fireworks coding-worker MCP server is configured in `opencode.json`; it reads its credential from `../.secrets/fw_api.txt` at runtime (or a path supplied via `FIREWORKS_KEY_FILE`). It returns proposed patches and never edits this checkout.
