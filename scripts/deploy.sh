#!/bin/bash
# Runs on the VM; builds happen in GitHub Actions.
set -Eeuo pipefail
cd /opt/agent-wiki
[[ ${1:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected commit SHA'; exit 1; }
exec 9>/tmp/agent-wiki-deploy.lock
flock -n 9 || exit 1
mountpoint -q /srv/agent-wiki/data
old_tag=$(sed -n 's/^IMAGE_TAG=//p' .env | tr -d '"')
export IMAGE_TAG="$1"
next=compose.yaml
[[ ! -f compose.next.yaml ]] || next=compose.next.yaml
docker compose -f "$next" pull agent-wiki-api agent-wiki-web agent-wiki-worker
cp compose.yaml compose.previous.yaml
cp Caddyfile Caddyfile.previous
cat > Caddyfile.maintenance <<'CADDY'
{$DOMAIN} {
 header Retry-After 60
 respond "잠시 업데이트 중입니다. 곧 다시 접속해 주세요." 503
}
CADDY
docker compose cp Caddyfile.maintenance agent-wiki-gateway:/tmp/maintenance
restore_ingress() { docker compose exec -T agent-wiki-gateway caddy reload --config /etc/caddy/Caddyfile; }
rollback() {
 trap - ERR
 echo 'Deployment failed; restoring previous application configuration'
 docker compose stop -t 45 agent-wiki-web || true
 docker compose stop -t 120 agent-wiki-worker || true
 docker compose stop -t 45 agent-wiki-api || true
 cp compose.previous.yaml compose.yaml
 cat Caddyfile.previous > Caddyfile
 export IMAGE_TAG="$old_tag"
 docker compose up -d --no-deps --no-build --wait agent-wiki-api agent-wiki-web agent-wiki-worker || true
 restore_ingress || true
 exit 1
}
trap rollback ERR
docker compose exec -T agent-wiki-gateway caddy reload --adapter caddyfile --config /tmp/maintenance
docker compose stop -t 45 agent-wiki-web
# Keep API/DB available while the Worker finishes its current publication.
docker compose stop -t 120 agent-wiki-worker
docker compose stop -t 45 agent-wiki-api
if [[ -f compose.next.yaml ]]; then mv compose.next.yaml compose.yaml; fi
if [[ -f Caddyfile.next ]]; then cat Caddyfile.next > Caddyfile; fi
docker run --rm --network agent-wiki_wiki --env-file migration.env -v /srv/agent-wiki/data/tls/ca.crt:/run/wiki-ca.crt:ro "ghcr.io/agent-observatory/agent-wiki-api:$IMAGE_TAG" node dist/packages/core/src/migrate.js
docker compose up -d --no-deps --no-build --wait agent-wiki-api agent-wiki-web agent-wiki-worker
restore_ingress
python3 - <<'PYENV'
import os,re
from pathlib import Path
p=Path('.env');p.write_text(re.sub(r'^IMAGE_TAG=.*$', 'IMAGE_TAG='+os.environ['IMAGE_TAG'], p.read_text(), flags=re.M))
PYENV
trap - ERR
printf 'Deployed %s\n' "$IMAGE_TAG"
