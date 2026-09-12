#!/bin/bash
# One-time deployment transition from the initial short Compose service names.
# Bind mounts, database contents, TLS material and the Compose network are retained.
set -Eeuo pipefail
cd /opt/agent-wiki
[[ ${1:-} =~ ^[a-f0-9]{40}$ ]] || exit 1
exec 9>/tmp/agent-wiki-deploy.lock
flock -n 9 || exit 1
mountpoint -q /srv/agent-wiki/data
test -f compose.next.yaml && test -f Caddyfile.next
# The existing CA must already have signed the DB certificate for its new hostname.
openssl x509 -in /srv/agent-wiki/data/tls/server.crt -noout -checkhost agent-wiki-db | grep -q 'does match'
old_tag=$(sed -n 's/^IMAGE_TAG=//p' .env | tr -d '"')
export IMAGE_TAG="$1"
docker compose -f compose.next.yaml pull
umask 077
for f in compose.yaml Caddyfile api.env worker.env migration.env; do cp "$f" "$f.before-naming"; done
old() { IMAGE_TAG="$old_tag" docker compose -f compose.yaml.before-naming "$@"; }
new() { docker compose -f compose.next.yaml "$@"; }
rollback() {
 trap - ERR
 echo 'Name migration failed; restoring the original services'
 new stop -t 45 agent-wiki-web || true
 new stop -t 120 agent-wiki-worker || true
 new stop -t 45 agent-wiki-api || true
 new stop -t 120 agent-wiki-db || true
 new stop -t 30 agent-wiki-gateway || true
 for f in compose.yaml Caddyfile api.env worker.env migration.env; do cat "$f.before-naming" > "$f"; done
 old up -d --no-deps --no-build --wait postgres || true
 old up -d --no-deps --no-build --wait api web worker caddy || true
 old exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
 exit 1
}
cat > Caddyfile.maintenance <<'CADDY'
{$DOMAIN} {
 header Retry-After 60
 respond "잠시 업데이트 중입니다. 곧 다시 접속해 주세요." 503
}
CADDY
old cp Caddyfile.maintenance caddy:/tmp/maintenance
trap rollback ERR
old exec -T caddy caddy reload --adapter caddyfile --config /tmp/maintenance
old stop -t 45 web
old stop -t 120 worker
old stop -t 45 api
old stop -t 120 postgres
# Only the internal DB hostname changes; credentials remain byte-for-byte intact.
python3 - <<'PY'
from pathlib import Path
for name in ['api.env', 'worker.env', 'migration.env']:
 p=Path(name)
 p.write_text(p.read_text().replace('@postgres:5432/', '@agent-wiki-db:5432/'))
PY
new up -d --no-deps --no-build --wait agent-wiki-db
docker run --rm --network agent-wiki_wiki --env-file migration.env -v /srv/agent-wiki/data/tls/ca.crt:/run/wiki-ca.crt:ro "ghcr.io/agent-observatory/agent-wiki-api:$IMAGE_TAG" node dist/packages/core/src/migrate.js
new up -d --no-deps --no-build --wait agent-wiki-api agent-wiki-web agent-wiki-worker
cat Caddyfile.next > Caddyfile
old stop -t 30 caddy
new up -d --no-deps --no-build --wait agent-wiki-gateway
new exec -T agent-wiki-gateway caddy reload --config /etc/caddy/Caddyfile
cp compose.next.yaml compose.yaml
python3 - <<'PYENV'
import os,re
from pathlib import Path
p=Path('.env');p.write_text(re.sub(r'^IMAGE_TAG=.*$', 'IMAGE_TAG='+os.environ['IMAGE_TAG'], p.read_text(), flags=re.M))
PYENV
trap - ERR
# Remove stopped containers only, never volumes or mounted directories.
old rm -f web worker api postgres caddy
printf 'Service names migrated at %s\n' "$IMAGE_TAG"
