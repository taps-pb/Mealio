#!/usr/bin/env bash
# Uses only a disposable local PostgreSQL cluster and synthetic data.
set -euo pipefail
umask 077
for prefix in /opt/homebrew /usr/local; do
  if [[ -d "$prefix/opt/postgresql@18/bin" ]]; then PATH="$prefix/opt/postgresql@18/bin:$PATH"; break; fi
done
export PATH
for tool in initdb pg_ctl psql pg_restore age age-keygen; do command -v "$tool" >/dev/null; done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/mealio-backup-test.XXXXXX")"
SERVER_STARTED=0
cleanup() {
  if [[ "$SERVER_STARTED" == 1 ]]; then pg_ctl -D "$TEMP/pg" stop -m immediate -w >/dev/null 2>&1 || :; fi
  rm -rf -- "$TEMP"
}
trap cleanup EXIT
mkdir -m 700 "$TEMP/config" "$TEMP/drive" "$TEMP/socket"
initdb -D "$TEMP/pg" -A trust --no-instructions >/dev/null
pg_ctl -D "$TEMP/pg" -o "-k $TEMP/socket -c listen_addresses=''" -l "$TEMP/server.log" start -w >/dev/null
SERVER_STARTED=1
PGHOST="$TEMP/socket" PGDATABASE=postgres psql -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE admins (id text PRIMARY KEY, timezone text NOT NULL);
CREATE TABLE meals (id text PRIMARY KEY, description text NOT NULL, eaten_at timestamptz NOT NULL, item_snapshots jsonb NOT NULL);
CREATE TABLE indb_catalogs (id text PRIMARY KEY, records jsonb NOT NULL);
INSERT INTO admins VALUES ('synthetic-owner', 'Asia/Kolkata');
INSERT INTO meals VALUES ('synthetic-meal', 'dummy dal', '2026-09-28 23:30:00+00', '[{"uncertainty":"synthetic"}]');
INSERT INTO indb_catalogs VALUES ('synthetic-catalog', '[]');
SQL
printf 'postgresql:///postgres?host=%s/socket\n' "$TEMP" > "$TEMP/config/neon-direct-url.txt"
age-keygen -o "$TEMP/config/age-identity.txt" >/dev/null 2>&1
age-keygen -y "$TEMP/config/age-identity.txt" > "$TEMP/config/age-recipient.txt"
printf '%s\n' "$TEMP/drive" > "$TEMP/config/drive-folder.txt"
chmod 600 "$TEMP/config/"*.txt
DAY="$(date '+%Y-%m-%d')"
ARCHIVE="$TEMP/drive/Mealio-$DAY.dump.age"
printf 'not-an-age-recipient\n' > "$TEMP/config/age-recipient.txt"
if MEALIO_BACKUP_CONFIG="$TEMP/config" MEALIO_BACKUP_SYNTHETIC_TEST=1 bash "$ROOT/scripts/backup-neon.sh" >/dev/null 2>&1; then
  echo 'Backup incorrectly accepted an invalid encryption recipient' >&2
  exit 1
fi
[[ ! -e "$ARCHIVE" && ! -e "$ARCHIVE.sha256" ]]
age-keygen -y "$TEMP/config/age-identity.txt" > "$TEMP/config/age-recipient.txt"
MEALIO_BACKUP_CONFIG="$TEMP/config" MEALIO_BACKUP_SYNTHETIC_TEST=1 bash "$ROOT/scripts/backup-neon.sh"
[[ -s "$ARCHIVE" && -s "$ARCHIVE.sha256" ]]
shasum -a 256 "$ARCHIVE" | awk '{print $1}' | grep -qx "$(cat "$ARCHIVE.sha256")"
age -d -i "$TEMP/config/age-identity.txt" "$ARCHIVE" | pg_restore --list | grep -q 'TABLE DATA public meals'
MEALIO_BACKUP_SYNTHETIC_TEST=1 bash "$ROOT/scripts/verify-neon-restore.sh" "$ARCHIVE" "$TEMP/config/age-identity.txt"
MEALIO_BACKUP_CONFIG="$TEMP/config" MEALIO_BACKUP_SYNTHETIC_TEST=1 bash "$ROOT/scripts/backup-neon.sh"
if MEALIO_BACKUP_CONFIG="$TEMP/missing" MEALIO_BACKUP_SYNTHETIC_TEST=1 bash "$ROOT/scripts/backup-neon.sh" >/dev/null 2>&1; then
  echo 'Backup incorrectly accepted missing configuration' >&2
  exit 1
fi
echo 'Synthetic encrypted backup, checksum, decryption, table data and daily skip passed.'
