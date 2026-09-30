#!/usr/bin/env bash
# Private, once-per-local-day encrypted pg_dump. No plaintext archive is written.
set -euo pipefail
umask 077
for prefix in /opt/homebrew /usr/local; do
  if [[ -d "$prefix/opt/postgresql@18/bin" ]]; then PATH="$prefix/opt/postgresql@18/bin:$PATH"; break; fi
done
export PATH

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${MEALIO_BACKUP_CONFIG:-$HOME/Library/Application Support/MealioBackup/private}"
URL_FILE="$CONFIG/neon-direct-url.txt"
RECIPIENT_FILE="$CONFIG/age-recipient.txt"
IDENTITY_FILE="$CONFIG/age-identity.txt"
DRIVE_FILE="$CONFIG/drive-folder.txt"

fail() { echo "Mealio backup failed: $1" >&2; exit 1; }
for tool in pg_dump pg_restore age shasum python3 shlock; do command -v "$tool" >/dev/null || fail "missing required tool: $tool"; done
[[ -d "$CONFIG" && ! -L "$CONFIG" ]] || fail "private config directory is missing";
[[ "$(stat -f '%Lp' "$CONFIG")" == 700 ]] || fail "private config directory must be mode 700"

private_file() {
  [[ -f "$1" && ! -L "$1" && -s "$1" ]] || fail "missing private configuration file"
  local mode
  mode="$(stat -f '%Lp' "$1")"
  [[ "$mode" == 600 || "$mode" == 400 ]] || fail "private configuration files must be mode 600 or 400"
}
for file in "$URL_FILE" "$RECIPIENT_FILE" "$IDENTITY_FILE" "$DRIVE_FILE"; do private_file "$file"; done
if ! shlock -f "$CONFIG/.backup-running" -p "$$"; then
  echo "Mealio backup already running; this attempt will retry later."
  exit 0
fi
unlock() { rm -f -- "$CONFIG/.backup-running"; }
trap unlock EXIT

DRIVE="$(cat "$DRIVE_FILE")"
[[ "$DRIVE" == /* && -d "$DRIVE" && -w "$DRIVE" && ! -L "$DRIVE" ]] || fail "Google Drive folder is unavailable"

if [[ "${MEALIO_BACKUP_SYNTHETIC_TEST:-0}" != 1 ]]; then
  case "$DRIVE" in "$HOME"/Library/CloudStorage/GoogleDrive-*/*) : ;; *) fail "choose a Google Drive for desktop folder under Library/CloudStorage" ;; esac
fi

DAY="$(date '+%Y-%m-%d')"
NAME="Mealio-$DAY.dump.age"
ARCHIVE="$DRIVE/$NAME"
CHECKSUM="$ARCHIVE.sha256"
# A valid archive and checksum from this day mean the login/wake retry can skip.
if [[ -s "$ARCHIVE" && -s "$CHECKSUM" ]]; then
  actual="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
  if [[ "$actual" == "$(cat "$CHECKSUM")" ]]; then echo "Mealio backup already completed today."; exit 0; fi
fi
[[ ! -e "$ARCHIVE" && ! -e "$CHECKSUM" ]] || fail "today's existing archive/checksum is incomplete or corrupt; preserve it for investigation"

PARTIAL="$(mktemp "$DRIVE/.Mealio-$DAY.XXXXXXXX.partial")"
PARTIAL_HASH="$PARTIAL.sha256"
cleanup() { rm -f -- "$PARTIAL" "$PARTIAL_HASH"; unlock; }
trap cleanup EXIT

# Suppress raw libpq and age errors: they may contain connection details.
if ! python3 "$ROOT/scripts/pg-dump-private.py" "$URL_FILE" 2>/dev/null | age -R "$RECIPIENT_FILE" -o "$PARTIAL" 2>/dev/null; then
  fail "database dump or encryption did not complete (check local credentials and connection)"
fi
[[ -s "$PARTIAL" ]] || fail "encrypted archive is empty"

# Verify the entire encrypted stream decrypts and the archive has the key tables.
if ! listing="$(age -d -i "$IDENTITY_FILE" "$PARTIAL" 2>/dev/null | pg_restore --list 2>/dev/null)"; then
  fail "encrypted archive could not be decrypted or read"
fi
for table in admins meals indb_catalogs; do
  grep -Eq "TABLE public $table([[:space:]]|$)" <<< "$listing" || fail "archive missing an expected table"
  grep -Eq "TABLE DATA public $table([[:space:]]|$)" <<< "$listing" || fail "archive missing an expected table data entry"
done
shasum -a 256 "$PARTIAL" | awk '{print $1}' > "$PARTIAL_HASH"

mv -n -- "$PARTIAL" "$ARCHIVE"
[[ ! -e "$PARTIAL" ]] || fail "archive already exists; refusing to overwrite"
mv -n -- "$PARTIAL_HASH" "$CHECKSUM"
[[ ! -e "$PARTIAL_HASH" ]] || fail "checksum already exists; refusing to overwrite"
echo "Mealio encrypted backup created for $DAY in the configured Drive folder. Confirm it also appears on drive.google.com."
