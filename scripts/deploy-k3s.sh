#!/bin/bash
# VM-side application delivery. Read a short-lived registry token from stdin.
set -Eeuo pipefail
[[ $EUID == 0 && ${1:-} =~ ^[a-f0-9]{40}$ ]] || exit 1
root=$(cd "$(dirname "$0")/.." && pwd)
app=/opt/agent-wiki
[[ -f /tmp/agent-wiki-deploy.lock ]] || install -o ubuntu -g ubuntu -m 600 /dev/null /tmp/agent-wiki-deploy.lock
exec 9</tmp/agent-wiki-deploy.lock
flock -n 9 || exit 1
mountpoint -q /srv/agent-wiki/data
test -f "$app/.k3s-active"
tag=$1
old_tag=$(cat "$app/.k3s-active")
domain=$(sed -n 's/^DOMAIN=//p' "$app/.env")
k() { k3s kubectl "$@"; }
python3 "$root/scripts/render-k3s.py" --image "$tag" --domain "$domain" --out "$root/rendered"
python3 "$root/scripts/k3s-secrets.py" "${2:?Registry user required}"
# Pre-pull each app through short-lived Pods using the registry Secret.
for role in api web worker; do
 name=agent-wiki-prepull-$role
 k -n agent-wiki delete pod "$name" --ignore-not-found --wait=true >/dev/null
 python3 - "$name" "$role" "$tag" <<'PY' | k apply -f - >/dev/null
import json,sys
name,role,tag=sys.argv[1:]
print(json.dumps({'apiVersion':'v1','kind':'Pod','metadata':{'name':name,'namespace':'agent-wiki'},'spec':{'restartPolicy':'Never','automountServiceAccountToken':False,'imagePullSecrets':[{'name':'ghcr'}],'containers':[{'name':'pull','image':f'ghcr.io/agent-observatory/agent-wiki-{role}:{tag}','imagePullPolicy':'IfNotPresent','command':['node','--version'],'resources':{'requests':{'cpu':'10m','memory':'32Mi'},'limits':{'cpu':'200m','memory':'64Mi'}}}]}}))
PY
 k -n agent-wiki wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$name" --timeout=240s
 k -n agent-wiki delete pod "$name" --wait=true >/dev/null
done
rollback() {
 trap - ERR
 echo 'Application rollout failed; restoring previous app images.'
 for role in api web worker; do
  k -n agent-wiki set image deployment/agent-wiki-$role agent-wiki-$role="ghcr.io/agent-observatory/agent-wiki-$role:$old_tag" || true
 done
 exit 1
}
trap rollback ERR
k apply -f "$root/rendered/network.json"
k apply -f "$root/rendered/migration.json"
k -n agent-wiki wait --for=condition=complete job/agent-wiki-migrate-${tag:0:12} --timeout=180s
k apply -f "$root/rendered/apps.json"
for role in api web worker; do k -n agent-wiki rollout status deployment/agent-wiki-$role --timeout=300s; done
k apply -f "$root/rendered/routing.json"
curl -fsS --max-time 20 "https://$domain/readyz" >/dev/null
printf '%s\n' "$tag" > "$app/.k3s-active"
python3 - "$app/.env" "$tag" <<'PY'
import re,sys
from pathlib import Path
p=Path(sys.argv[1]);p.write_text(re.sub(r'^IMAGE_TAG=.*$', 'IMAGE_TAG='+sys.argv[2],p.read_text(),flags=re.M))
PY
trap - ERR
printf 'K3s deployed %s\n' "$tag"
