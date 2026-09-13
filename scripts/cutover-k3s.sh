#!/bin/bash
# One-time migration of an existing Compose installation, with the same PostgreSQL disk.
set -Eeuo pipefail
[[ $EUID == 0 && ${1:-} =~ ^[a-f0-9]{40}$ ]] || exit 1
root=$(cd "$(dirname "$0")/.." && pwd)
app=/opt/agent-wiki
cd "$app"
[[ -f /tmp/agent-wiki-deploy.lock ]] || install -o ubuntu -g ubuntu -m 600 /dev/null /tmp/agent-wiki-deploy.lock
exec 9</tmp/agent-wiki-deploy.lock
flock -n 9 || exit 1
[[ ! -f .k3s-active ]] || { echo 'K3s already active'; exit 1; }
mountpoint -q /srv/agent-wiki/data
test "$(cat /srv/agent-wiki/data/postgres/PG_VERSION)" = 17
# Always migrate the currently deployed code first; application upgrades happen afterwards.
tag=$(sed -n 's/^IMAGE_TAG=//p' .env)
[[ $tag == "$1" ]] || { echo 'Cutover requires the currently deployed image'; exit 1; }
domain=$(sed -n 's/^DOMAIN=//p' .env)
k() { k3s kubectl "$@"; }
k wait --for=condition=Ready node/agent-wiki-vm --timeout=60s
python3 "$root/scripts/render-k3s.py" --image "$tag" --domain "$domain" --out "$root/rendered"
k apply -f "$root/rendered/namespace.json"
python3 "$root/scripts/k3s-secrets.py"
bash "$root/scripts/configure-k3s-logs.sh"
# Images already exist locally, so registry credentials and rebuilds aren't needed for cutover.
for image in "postgres:17.9-bookworm" "ghcr.io/agent-observatory/agent-wiki-api:$tag" "ghcr.io/agent-observatory/agent-wiki-worker:$tag" "ghcr.io/agent-observatory/agent-wiki-web:$tag"; do
 docker save "$image" | k3s ctr images import - >/dev/null
done
k apply --dry-run=server -f "$root/rendered/db.json" >/dev/null
k apply --dry-run=server -f "$root/rendered/apps.json" >/dev/null
k apply -f "$root/rendered/network.json"
# Personal development service: stop the old stack, then finish forward on K3s.
# Never start Compose again automatically while the same DB is attached to K3s.
trap 'echo "K3s cutover incomplete; inspect Kubernetes and continue forward."' ERR
docker compose stop -t 120
systemctl disable agent-wiki.service
k apply -f "$root/rendered/db.json"
k -n agent-wiki rollout status statefulset/agent-wiki-db --timeout=180s
k apply -f "$root/rendered/apps.json"
for role in api web worker; do k -n agent-wiki rollout status deployment/agent-wiki-$role --timeout=240s; done
bash "$root/scripts/configure-k3s-logs.sh"
# Only now give 80/443 to Traefik. No public load balancer is provisioned.
k apply -f "$root/rendered/gateway.json"
for attempt in $(seq 1 90); do k -n kube-system get deployment agent-wiki-gateway >/dev/null 2>&1 && break; sleep 2; done
k -n kube-system rollout status deployment/agent-wiki-gateway --timeout=180s
k apply -f "$root/rendered/routing.json"
for attempt in $(seq 1 30); do curl -fsS --max-time 5 "https://$domain/readyz" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS --max-time 15 "https://$domain/readyz" >/dev/null
k apply -f "$root/rendered/certificate.json"
systemctl disable agent-wiki.service
# Disable legacy restart policies until the stopped containers are removed.
for name in agent-wiki-web agent-wiki-worker agent-wiki-api agent-wiki-db agent-wiki-gateway; do docker update --restart=no "$name" >/dev/null; done
printf '%s\n' "$tag" > "$app/.k3s-active"
trap - ERR
printf 'K3s cutover completed for %s\n' "$tag"
