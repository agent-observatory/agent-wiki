#!/bin/bash
# Root-only installation from a private staging directory on the VM.
set -euo pipefail
stage=${1:?Expected staging directory}
[[ $EUID == 0 && $stage == /opt/agent-wiki/.bootstrap.* && -d $stage && ! -L $stage ]] || exit 1
app=/opt/agent-wiki
data=/srv/agent-wiki/data
mountpoint -q "$data"
# CLI-readable secrets belong to ubuntu; PostgreSQL reads its own config as uid 999.
for name in .env api.env migration.env compose.yaml Caddyfile; do
 install -o ubuntu -g ubuntu -m 600 "$stage/$name" "$app/$name"
done
install -o 999 -g 999 -m 600 "$stage/init-db.sql" "$app/init-db.sql"
install -m 644 "$stage/pg_hba.conf" "$app/pg_hba.conf"
install -d -m 755 "$data/tls"
install -o 999 -g 999 -m 600 "$stage/server.key" "$data/tls/server.key"
install -m 644 "$stage/server.crt" "$stage/ca.crt" "$data/tls/"
mkdir -p "$data/postgres"
chown 999:999 "$data/postgres"
