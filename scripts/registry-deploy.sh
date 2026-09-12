#!/bin/bash
# Read the short-lived, repository-scoped Actions token on stdin, not argv.
set -euo pipefail
[[ ${1:-} =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ ${2:-} =~ ^[A-Za-z0-9_-]+$ ]] || exit 1
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d /tmp/wiki-registry.XXXXXX)
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
IFS= read -r credential
printf '%s' "$credential" | docker login ghcr.io -u "$2" --password-stdin
unset credential
cd /opt/agent-wiki
if docker compose ps --status running --services | grep -qx caddy; then
 bash deploy.sh "$1"
else
 bash first-deploy.sh "$1"
fi
