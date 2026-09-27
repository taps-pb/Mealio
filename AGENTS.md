# Mealio coding workspace

- `code/` is the future Git/deployment root. The approved scope and UI references live in `../plan/v1-scope-and-tests.md`, `../plan/ui-preview.html`, and `../plan/color-variations.html`; they are not part of this repo. Light mode = style 8, dark mode = style 2.
- One private owner account only: no signup, no public reset. Preserve nutrition snapshots and timezone-correct meal history. Never silently replace manual corrections with AI estimates.
- The project-local MCP bridge is `tools/fireworks_workers.py` via `opencode.json`; it reads the key from `../.secrets/fw_api.txt` at runtime (or `FIREWORKS_KEY_FILE` as a path override). Do not copy or log the key.
- Only delegate to `accounts/fireworks/models/deepseek-v4p1-flash` and `accounts/fireworks/models/glm-5p3-flash`. Give workers non-overlapping tasks, context, and acceptance criteria; they return proposals/patches, never edit this checkout. The orchestrator reviews, integrates, and runs checks.
