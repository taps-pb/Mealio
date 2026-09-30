#!/usr/bin/env bash
# Restore a private archive into a NEW local Unix-socket-only Postgres cluster.
# Never accepts a database target or contacts Neon.
set -euo pipefail
umask 077
for prefix in /opt/homebrew /usr/local; do
  if [[ -d "$prefix/opt/postgresql@18/bin" ]]; then PATH="$prefix/opt/postgresql@18/bin:$PATH"; break; fi
done
export PATH
fail() { echo "Mealio restore drill failed: $1" >&2; exit 1; }
[[ $# == 2 ]] || fail "usage: verify-neon-restore.sh /path/to/archive.dump.age /private/age-identity.txt"
ARCHIVE="$1"
IDENTITY="$2"
[[ -s "$ARCHIVE" && -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || fail "encrypted archive is missing"
[[ -s "$IDENTITY" && -f "$IDENTITY" && ! -L "$IDENTITY" ]] || fail "private decryption identity is missing"
[[ "$(stat -f '%Lp' "$IDENTITY")" == 600 || "$(stat -f '%Lp' "$IDENTITY")" == 400 ]] || fail "identity must be mode 600 or 400"
for tool in initdb pg_ctl pg_restore psql age shasum fdesetup; do command -v "$tool" >/dev/null || fail "missing required tool: $tool"; done

if [[ "${MEALIO_BACKUP_SYNTHETIC_TEST:-0}" == 1 ]]; then
  case "$ARCHIVE" in "${TMPDIR:-/tmp}"/mealio-backup-test.*/*) : ;; *) fail "synthetic test archives must stay in the disposable test directory" ;; esac
else
  [[ "$(fdesetup status 2>/dev/null)" == "FileVault is On." ]] || fail "FileVault must be enabled before restoring private data locally"
fi
if [[ -f "$ARCHIVE.sha256" ]]; then
  expected="$(cat "$ARCHIVE.sha256")"
  actual="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || fail "encrypted archive checksum mismatch"
fi

TEMP="$(mktemp -d "${TMPDIR:-/tmp}/mealio-restore.XXXXXX")"
SERVER_STARTED=0
cleanup() {
  if [[ "$SERVER_STARTED" == 1 ]]; then pg_ctl -D "$TEMP/pg" stop -m immediate -w >/dev/null 2>&1 || :; fi
  # Remove ONLY the private directory made by mktemp above.
  rm -rf -- "$TEMP"
}
trap cleanup EXIT
mkdir -m 700 "$TEMP/socket"
initdb -D "$TEMP/pg" -A trust --no-instructions >/dev/null 2>&1 || fail "could not initialize isolated database"
pg_ctl -D "$TEMP/pg" -o "-k $TEMP/socket -c listen_addresses='' -c unix_socket_permissions=0700" -l "$TEMP/server.log" start -w >/dev/null 2>&1 || fail "could not start isolated database"
SERVER_STARTED=1
export PGHOST="$TEMP/socket" PGDATABASE=postgres
# Never use inherited production libpq settings or a production connection URL.
unset PGHOSTADDR PGPORT PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PGSSLMODE
psql -X -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE mealio_restore' >/dev/null 2>&1 || fail "could not create isolated restore target"
if ! age -d -i "$IDENTITY" "$ARCHIVE" 2>/dev/null |
  pg_restore --dbname=mealio_restore --single-transaction --exit-on-error --no-owner --no-acl 2>/dev/null; then
  fail "archive decryption or isolated database restore failed"
fi

# Only aggregates escape the temporary cluster; never show account/meal/catalog data.
checks="$(PGDATABASE=mealio_restore psql -X -v ON_ERROR_STOP=1 -At -c "
  SELECT (SELECT count(*) FROM public.admins),
         (SELECT count(*) FROM public.meals),
         (SELECT count(*) FROM public.indb_catalogs),
         (SELECT count(*) FROM public.meals WHERE jsonb_typeof(item_snapshots) <> 'array'),
         (SELECT count(*) FROM public.meals WHERE eaten_at IS NULL),
         (SELECT count(*) FROM public.admins a WHERE NOT EXISTS
           (SELECT 1 FROM pg_timezone_names t WHERE t.name = a.timezone));
" 2>/dev/null)" || fail "restored tables or integrity query failed"
IFS='|' read -r owners meal_count catalog_count bad_snapshots bad_times bad_timezones <<< "$checks"
[[ "$owners" == 1 && "$catalog_count" -ge 1 && "$bad_snapshots" == 0 && "$bad_times" == 0 && "$bad_timezones" == 0 ]] || fail "restored owner, catalog, snapshots, or timezone validation failed"
echo "Isolated restore passed: $owners owner, $meal_count meals, $catalog_count catalog entries; snapshots and timezone valid."
