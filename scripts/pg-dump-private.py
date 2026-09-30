#!/usr/bin/env python3
"""Read a private URL and exec pg_dump with libpq env vars, never argv/logs."""
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


def fail():
    print("Mealio backup failed: invalid direct database connection configuration", file=sys.stderr)
    raise SystemExit(1)


if len(sys.argv) != 2:
    fail()

try:
    url = urlsplit(Path(sys.argv[1]).read_text().strip())
    query = parse_qs(url.query, strict_parsing=True)
    database = unquote(url.path.removeprefix("/"))
    if url.scheme not in ("postgres", "postgresql") or not database or url.fragment:
        fail()
    if os.environ.get("MEALIO_BACKUP_SYNTHETIC_TEST") == "1":
        # Test mode can only access a local Unix socket; never a remote database.
        host = query.get("host", [""])[0]
        if url.hostname or not host.startswith("/var/folders/") and not host.startswith("/private/var/folders/"):
            fail()
        if url.password or url.username or set(query) != {"host"}:
            fail()
        values = {"PGHOST": host, "PGDATABASE": database}
    else:
        host = url.hostname or ""
        if (not host.endswith(".neon.tech") or "-pooler" in host or
                not url.username or not url.password or url.port not in (None, 5432) or
                query.get("sslmode", [""])[0] not in ("require", "verify-ca", "verify-full") or
                set(query) - {"sslmode", "channel_binding", "connect_timeout"}):
            fail()
        values = {"PGHOST": host, "PGPORT": str(url.port or 5432),
                  "PGDATABASE": database, "PGUSER": unquote(url.username),
                  "PGPASSWORD": unquote(url.password), "PGSSLMODE": query["sslmode"][0]}
        if "channel_binding" in query:
            values["PGCHANNELBINDING"] = query["channel_binding"][0]
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith("PG") and key != "MEALIO_BACKUP_SYNTHETIC_TEST"}
    environment.update(values)
    os.execvpe("pg_dump", ["pg_dump", "--format=custom", "--no-owner", "--no-acl"], environment)
except (ValueError, OSError, KeyError):
    fail()
