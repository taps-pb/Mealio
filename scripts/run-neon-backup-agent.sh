#!/usr/bin/env bash
# launchd entry point: hourly retry, with one generic failure notification/day.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if bash "$ROOT/scripts/backup-neon.sh"; then exit 0; fi
STATE="$HOME/Library/Logs/MealioBackup"
mkdir -p "$STATE"
chmod 700 "$STATE"
MARKER="$STATE/last-alert-day"
TODAY="$(date '+%Y-%m-%d')"
if [[ ! -f "$MARKER" || "$(cat "$MARKER")" != "$TODAY" ]]; then
  printf '%s\n' "$TODAY" > "$MARKER"
  chmod 600 "$MARKER"
  /usr/bin/osascript -e 'display notification "Encrypted backup did not finish. Check MealioBackup logs." with title "Mealio backup"' >/dev/null 2>&1 || :
fi
exit 1
