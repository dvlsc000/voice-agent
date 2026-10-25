#!/usr/bin/env bash
# Spin up a throwaway local PostgreSQL, apply the Supabase shim + all migrations, run DB tests.
# Usage: pnpm db:test
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="${PGDATA_DIR:-$(mktemp -d /tmp/vp-pg-XXXX)}"
PORT="${PGPORT:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then RUN_AS="runuser -u ${PG_OS_USER:-claude} --"; chown -R "${PG_OS_USER:-claude}" "$DATA"; fi

$RUN_AS "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
$RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=127.0.0.1" -l "$DATA/log" -w start >/dev/null
trap '$RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
(cd "$ROOT/packages/db" && npx vitest run "$@")
(cd "$ROOT/packages/server" && npx vitest run "$@")
(cd "$ROOT/apps/voice-gateway" && npx vitest run "$@")
