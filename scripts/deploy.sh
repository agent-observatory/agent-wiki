#!/bin/bash
# Runs on the VM; builds happen in GitHub Actions.
set -euo pipefail
cd /opt/agent-wiki
[[ ${1:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected commit SHA'; exit 1; }
exec 9>/tmp/agent-wiki-deploy.lock
flock -n 9 || exit 1
mountpoint -q /srv/agent-wiki/data
old_tag=$(sed -n 's/^IMAGE_TAG=//p' .env | tr -d '"')
export IMAGE_TAG="$1"
# API and Worker share an image; download while traffic is still served.
docker compose pull api web
cp compose.yaml compose.previous.yaml
old_worker=0
if docker compose config --services | grep -qx worker; then old_worker=1; fi
cat > Caddyfile.maintenance <<'CADDY'
{$DOMAIN} {
 header Retry-After 60
 respond "잠시 업데이트 중입니다. 곧 다시 접속해 주세요." 503
}
CADDY
docker compose cp Caddyfile.maintenance caddy:/tmp/maintenance
restore_ingress() { docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; }
rollback() {
 echo 'Deployment failed; restoring previous application configuration'
 if docker compose config --services | grep -qx worker; then docker compose stop -t 120 worker || true; fi
 cp compose.previous.yaml compose.yaml
 export IMAGE_TAG="$old_tag"
 docker compose up -d --no-deps --no-build --wait api web || true
 if [[ $old_worker == 1 ]]; then docker compose up -d --no-deps --no-build --wait worker || true; fi
 restore_ingress || true
}
docker compose exec -T caddy caddy reload --adapter caddyfile --config /tmp/maintenance
trap rollback ERR
docker compose stop -t 45 web
# Keep API/DB available while the Worker finishes its current publication.
if [[ $old_worker == 1 ]]; then docker compose stop -t 120 worker; fi
docker compose stop -t 45 api
if [[ -f compose.next.yaml ]]; then mv compose.next.yaml compose.yaml; fi
docker run --rm --network agent-wiki_wiki --env-file migration.env -v /srv/agent-wiki/data/tls/ca.crt:/run/wiki-ca.crt:ro "ghcr.io/agent-observatory/agent-wiki-app:$IMAGE_TAG" node dist/packages/core/src/migrate.js
docker compose up -d --no-deps --no-build --wait api web worker
restore_ingress
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" .env
trap - ERR
printf 'Deployed %s\n' "$IMAGE_TAG"
