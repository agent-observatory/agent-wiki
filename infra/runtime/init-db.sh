#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$PG_APP_PASSWORD" --set=admin_password="$PG_ADMIN_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE wiki_app LOGIN PASSWORD %L', :'app_password') \gexec
SELECT format('CREATE ROLE wiki_admin LOGIN BYPASSRLS PASSWORD %L', :'admin_password') \gexec
SQL
