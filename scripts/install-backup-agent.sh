#!/usr/bin/env bash
# Installs a user-only launchd agent; secrets are never embedded in the plist.
set -euo pipefail
umask 077
if [[ "${MEALIO_AGENT_EXPERIMENTAL:-0}" != 1 ]]; then
  echo "Not installed: macOS denied this launchd job access to the Google Drive desktop folder. See scripts/README-backups.md." >&2
  exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$HOME/Library/Application Support/MealioBackup"
CONFIG="$APP/private"
for name in neon-direct-url.txt age-recipient.txt age-identity.txt drive-folder.txt; do
  [[ -s "$CONFIG/$name" && ! -L "$CONFIG/$name" && "$(stat -f '%Lp' "$CONFIG/$name")" == 600 ]] || {
    echo "Private backup configuration is missing or not mode 600; see scripts/README-backups.md." >&2
    exit 1
  }
done
DRIVE="$(cat "$CONFIG/drive-folder.txt")"
[[ -d "$DRIVE" && -w "$DRIVE" ]] || { echo "Google Drive is not mounted and writable." >&2; exit 1; }
PLIST="$HOME/Library/LaunchAgents/app.mealio.backup.plist"
[[ ! -e "$PLIST" ]] || { echo "Agent already installed; inspect it before replacing." >&2; exit 1; }
LOG_DIR="$HOME/Library/Logs/MealioBackup"
SCRIPTS="$APP/scripts"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$SCRIPTS"
chmod 700 "$APP" "$SCRIPTS"
# launchd cannot read scripts in the macOS Documents protected folder. Install
# only these nonsensitive program files in the user-owned Application Support.
for name in run-neon-backup-agent.sh backup-neon.sh pg-dump-private.py; do
  install -m 700 "$ROOT/scripts/$name" "$SCRIPTS/$name"
done
chmod 700 "$LOG_DIR"
: > "$LOG_DIR/backup.out.log"
: > "$LOG_DIR/backup.err.log"
chmod 600 "$LOG_DIR/backup.out.log" "$LOG_DIR/backup.err.log"
python3 - "$PLIST" "$SCRIPTS" "$LOG_DIR" <<'PY'
import plistlib, sys
from pathlib import Path
target, scripts, log = map(Path, sys.argv[1:])
config = {
    'Label': 'app.mealio.backup',
    'ProgramArguments': ['/bin/bash', str(scripts / 'run-neon-backup-agent.sh')],
    'EnvironmentVariables': {'PATH': '/opt/homebrew/opt/postgresql@18/bin:/usr/local/opt/postgresql@18/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
    'RunAtLoad': True,
    'StartInterval': 3600,
    'StandardOutPath': str(log / 'backup.out.log'),
    'StandardErrorPath': str(log / 'backup.err.log'),
}
target.write_bytes(plistlib.dumps(config))
target.chmod(0o600)
PY
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  echo "launchd did not start the agent. The plist was kept for inspection; no successful backup is claimed." >&2
  exit 1
fi
echo "Mealio backup agent installed: it attempts now, then every hour, skipping after a successful local calendar day."
echo "Check the encrypted file on drive.google.com and run a separate restore drill before relying on it."
