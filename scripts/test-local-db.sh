#!/bin/bash
# Run the DB-backed test suite against a disposable PostgreSQL container.
# Mirrors .github/workflows/ci.yml (image, roles, port) so local and CI
# verification share one procedure. Requires Docker. No production data.
#
# Reuses the existing `wiki-test-postgres` container shared with Codex.
#
#   scripts/test-local-db.sh            # start → migrate + test → stop
#   scripts/test-local-db.sh --keep     # leave the container running
#   scripts/test-local-db.sh --down     # remove the container and its volume
#   PG_PORT=55433 scripts/test-local-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${PG_IMAGE:-postgres:17.9-bookworm}"
NAME="${PG_CONTAINER:-wiki-test-postgres}"
PORT="${PG_PORT:-55432}"
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --down)
      docker rm -f -v "$NAME" >/dev/null 2>&1 && echo "removed $NAME" || echo "$NAME not found"
      exit 0
      ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

# -i matters: without it docker exec leaves stdin closed, psql reads EOF, runs
# nothing and still exits 0 — so the role bootstrap below silently did nothing
# on a freshly created container and only "worked" when a previous run had
# already created the roles.
psql_owner() {
  docker exec -i -e PGPASSWORD=local-test-password "$NAME" \
    psql -U wiki_owner -d agent_wiki -v ON_ERROR_STOP=1 -q "$@"
}

if ! docker inspect "$NAME" >/dev/null 2>&1; then
  echo "starting $NAME ($IMAGE) on 127.0.0.1:$PORT"
  docker run -d --name "$NAME" \
    -e POSTGRES_USER=wiki_owner \
    -e POSTGRES_PASSWORD=local-test-password \
    -e POSTGRES_DB=agent_wiki \
    -p "127.0.0.1:$PORT:5432" \
    "$IMAGE" >/dev/null
elif [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != "true" ]; then
  docker start "$NAME" >/dev/null
fi

for _ in $(seq 1 40); do
  if docker exec "$NAME" pg_isready -U wiki_owner -d agent_wiki >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$NAME" pg_isready -U wiki_owner -d agent_wiki >/dev/null

# Same roles as the CI "Prepare test roles" step; idempotent for --keep reuse.
psql_owner <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_app') THEN
    CREATE ROLE wiki_app LOGIN PASSWORD 'local-app-password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_admin') THEN
    CREATE ROLE wiki_admin LOGIN BYPASSRLS PASSWORD 'local-admin-password';
  END IF;
END
$$;
SQL

cleanup() {
  if [ "$KEEP" = 1 ]; then
    echo "kept $NAME running; stop with: docker stop $NAME"
  else
    docker stop "$NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

export DATABASE_URL="postgresql://wiki_app:local-app-password@127.0.0.1:$PORT/agent_wiki"
export MIGRATION_DATABASE_URL="postgresql://wiki_owner:local-test-password@127.0.0.1:$PORT/agent_wiki"
scripts/test-local.sh
