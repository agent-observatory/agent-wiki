#!/bin/bash
# Synthetic permission and rerun check against the real installation script.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
docker run --rm -i --tmpfs /srv/agent-wiki/data -v "$root/scripts/install-runtime.sh:/install-runtime.sh:ro" --entrypoint bash postgres:17.9-bookworm -s <<'INNER'
set -euo pipefail
groupadd -g 1000 ubuntu
useradd -u 1000 -g ubuntu ubuntu
mkdir -p /opt/agent-wiki
chown ubuntu:ubuntu /opt/agent-wiki
for attempt in 1 2; do
 stage=$(runuser -u ubuntu -- mktemp -d /opt/agent-wiki/.bootstrap.XXXXXXXX)
 for name in .env api.env migration.env compose.yaml Caddyfile init-db.sql pg_hba.conf server.key server.crt ca.crt; do
  runuser -u ubuntu -- sh -c 'umask 077; printf "synthetic fixture\n" > "$1"' sh "$stage/$name"
 done
 bash /install-runtime.sh "$stage"
 runuser -u postgres -- test -r /opt/agent-wiki/pg_hba.conf
 runuser -u postgres -- test -r /opt/agent-wiki/init-db.sql
 runuser -u postgres -- test -r /srv/agent-wiki/data/tls/server.key
 runuser -u ubuntu -- test -r /opt/agent-wiki/api.env
 test "$(stat -c %a /srv/agent-wiki/data/tls/server.key)" = 600
 test "$(stat -c %u /srv/agent-wiki/data/tls/server.key)" = 999
 test "$(stat -c %a /opt/agent-wiki/api.env)" = 600
 if runuser -u postgres -- test -r /opt/agent-wiki/api.env; then exit 1; fi
 rm -rf "$stage"
 printf 'Runtime install attempt %s: permissions passed\n' "$attempt"
done
INNER
