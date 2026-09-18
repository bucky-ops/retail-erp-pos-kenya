#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# DukaFlow - Neon Postgres bootstrap (run OUTSIDE the sandbox or once
# api.neon.tech DNS resolves - during setup the host had no A/AAAA records).
#
# Prereqs:
#   export NEON_API_TOKEN="napi_..."        # Neon personal API key
#   curl + jq + python3 available
#
# What it does:
#   1. Verifies the token against GET /v2/users/me
#   2. Creates project "dukaflow" (Postgres 16, region aws/us-east-2)
#   3. Prints the pooled connection URI to pass to scripts/db-hosted.sh:
#        export DATABASE_URL="<pooled_uri_with_password>"
#        bash scripts/db-hosted.sh push && bash scripts/db-hosted.sh seed
# -----------------------------------------------------------------------------
set -euo pipefail

API="https://api.neon.tech/v2"
AUTH="Authorization: Bearer ${NEON_API_TOKEN:?set NEON_API_TOKEN}"

echo "== 1. token check =="
curl -sf -H "$AUTH" "$API/users/me" | python3 -c "import json,sys; u=json.load(sys.stdin); print('logged in as:', u.get('login') or u.get('email'))"

echo "== 2. create project =="
PROJECT=$(curl -sf -X POST -H "$AUTH" -H "Content-Type: application/json" "$API/projects" -d '{"project":{"name":"dukaflow","pg_version":16,"region_id":"aws-us-east-2"}}')
PID=$(echo "$PROJECT" | python3 -c "import json,sys; print(json.load(sys.stdin)['project']['id'])")
echo "project id: $PID"

echo "== 3. connection URIs =="
curl -sf -H "$AUTH" "$API/projects/$PID/connection_uris" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for u in d.get('connection_uris', []):
    print(u.get('name'), '->', u.get('connection_uri','<masked>').split('@')[-1])
print('re-run with the pooled URI as DATABASE_URL for scripts/db-hosted.sh')
"
echo "== done =="
