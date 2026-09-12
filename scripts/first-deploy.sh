#!/bin/bash
set -euo pipefail
cd /opt/agent-wiki
[[ ${1:-} =~ ^[a-f0-9]{40}$ ]] || exit 1
export IMAGE_TAG="$1"
exec 9>/tmp/agent-wiki-deploy.lock
flock -n 9 || exit 1
mountpoint -q /srv/agent-wiki/data
if [[ -f compose.next.yaml ]]; then mv compose.next.yaml compose.yaml; fi
if [[ -f Caddyfile.next ]]; then cat Caddyfile.next > Caddyfile; fi
docker compose pull
docker compose up -d --wait agent-wiki-db
docker run --rm --network agent-wiki_wiki --env-file migration.env -v /srv/agent-wiki/data/tls/ca.crt:/run/wiki-ca.crt:ro "ghcr.io/agent-observatory/agent-wiki-api:$IMAGE_TAG" node dist/packages/core/src/migrate.js
docker compose up -d --no-build --wait
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" .env
printf 'First release started: %s\n' "$IMAGE_TAG"
