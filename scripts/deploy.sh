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
docker compose pull api web
# Generate a maintenance route. Caddy admin is reachable only within its container.
cat > Caddyfile.maintenance <<'CADDY'
{$DOMAIN} {
 header Retry-After 60
 respond "잠시 업데이트 중입니다. 곧 다시 접속해 주세요." 503
}
CADDY
docker compose cp Caddyfile.maintenance caddy:/tmp/maintenance
restore_ingress() { docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; }
legacy_worker=0
transition=0
if docker compose config --services | grep -qx worker; then legacy_worker=1; touch .schema-v2-transition; fi
if [[ -f .schema-v2-transition ]]; then transition=1; fi
rollback() {
 if [[ $transition == 1 ]]; then echo "Schema transition failed; maintenance remains enabled for repair"; return; fi
 echo 'Deployment failed; restoring previous app images'
 export IMAGE_TAG="$old_tag"
 docker compose up -d --no-deps --no-build --wait api web || true
 restore_ingress || true
}
docker compose exec -T caddy caddy reload --adapter caddyfile --config /tmp/maintenance
trap rollback ERR
# Stop web first so accepted requests can finish internal calls to the old API.
docker compose stop -t 45 web
if [[ $legacy_worker == 1 ]]; then
 docker compose stop -t 120 worker
 docker compose rm -f worker
fi
docker compose stop -t 45 api
if [[ -f compose.next.yaml ]]; then mv compose.next.yaml compose.yaml; fi
rm -f worker.env
# Schema v2 performs the authorized one-time development reset.
# DDL credentials never reach the API.
docker run --rm --network agent-wiki_wiki --env-file migration.env -v /srv/agent-wiki/data/tls/ca.crt:/run/wiki-ca.crt:ro "ghcr.io/agent-observatory/agent-wiki-app:$IMAGE_TAG" node dist/packages/core/src/migrate.js
docker compose up -d --no-deps --no-build --wait api web
restore_ingress
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" .env
rm -f .schema-v2-transition
trap - ERR
printf 'Deployed %s\n' "$IMAGE_TAG"
