#!/bin/bash
set -euo pipefail
export DATABASE_URL="${DATABASE_URL:-postgresql://wiki_app:local-app-password@127.0.0.1:55432/agent_wiki}"
export MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:-postgresql://wiki_owner:local-test-password@127.0.0.1:55432/agent_wiki}"
export SOURCE_STORAGE=local APP_URL=http://localhost:3000
unset GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
npm run migrate
npm test
