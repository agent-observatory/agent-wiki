#!/bin/bash
# Runs on the VM; builds happen in GitHub Actions.
set -euo pipefail
cd /opt/agent-wiki
[[ ${1:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected commit SHA'; exit 1; }
exec 9>/tmp/agent-wiki-deploy.lock
flock -n 9 || exit 1
mountpoint -q /srv/agent-wiki/data
old_tag=$(sed -n 's/^IMAGE_TAG=//p' .env)
export IMAGE_TAG="$1"
docker compose pull api worker web
# Generate a maintenance route. Caddy admin is reachable only within its container.
cat > Caddyfile.maintenance <<'CADDY'
{$DOMAIN} {
 header Retry-After 60
 respond "잠시 업데이트 중입니다. 곧 다시 접속해 주세요." 503
}
CADDY
docker compose cp Caddyfile.maintenance caddy:/tmp/maintenance
restore_ingress() { docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; }
rollback() {
 echo 'Deployment failed; restoring previous app images'
 export IMAGE_TAG="$old_tag"
 docker compose up -d --no-deps --no-build --wait api worker web || true
 restore_ingress || true
}
docker compose exec -T caddy caddy reload --config /tmp/maintenance
trap rollback ERR
# Stop web first so accepted requests can finish internal calls to the old API.
docker compose stop -t 45 web
docker compose stop -t 120 worker
docker compose stop -t 45 api
# Migrations run with separate DDL credentials; never pass them to API/Worker.
docker run --rm --network agent-wiki_wiki --env-file migration.env "ghcr.io/agent-observatory/agent-wiki-app:$IMAGE_TAG" node dist/packages/core/src/migrate.js
docker compose up -d --no-deps --no-build --wait api worker web
restore_ingress
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" .env
trap - ERR
printf 'Deployed %s\n' "$IMAGE_TAG"
