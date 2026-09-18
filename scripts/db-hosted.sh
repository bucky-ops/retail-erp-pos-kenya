#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# DukaFlow - hosted database helper (Supabase Postgres today, Neon when ready)
#
# Usage:
#   export DATABASE_URL="postgresql://user:pass@host:5432/postgres"
#   bash scripts/db-hosted.sh push     # create/refresh schema from prisma/schema.postgres.prisma
#   bash scripts/db-hosted.sh seed     # run all seed scripts against the hosted DB
#   bash scripts/db-hosted.sh switch   # make the local dev server use the hosted DB
#   bash scripts/db-hosted.sh sqlite   # switch local dev back to the sandbox SQLite file
#
# Notes:
#   - The repo default is SQLite (prisma/schema.prisma) so the sandbox keeps
#     working offline. Hosted Postgres uses prisma/schema.postgres.prisma.
#   - Supabase: use the session pooler URL (port 5432, user postgres.<ref>).
#     Transaction pooler (6543) works for runtime but can be flaky for DDL.
#   - Neon: run the same commands with a Neon pooled connection string once
#     api.neon.tech DNS is reachable (see scripts/neon-setup.sh).
#   - Never commit real credentials. Secrets live in your shell env, GitHub
#     Actions secrets, or Vercel environment variables.
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

DB_DIR="db"
SQLITE_URL="file:${PWD}/${DB_DIR}/custom.db"

cmd="${1:-help}"

case "$cmd" in
  push)
    [ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is required"; exit 1; }
    bunx prisma db push --schema prisma/schema.postgres.prisma --accept-data-loss
    ;;
  seed)
    [ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is required"; exit 1; }
    bun prisma/seed.ts
    bun scripts/seed-round6.ts
    bun scripts/seed-debt-payments.ts
    bun scripts/backfill-stock-age.ts
    ;;
  switch)
    [ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is required"; exit 1; }
    echo "DATABASE_URL=${DATABASE_URL}" > .env.hosted
    echo "Restart the dev server so it picks up .env.hosted (bun run db:switch-hosted or restart manually)."
    ;;
  sqlite)
    rm -f .env.hosted
    echo "DATABASE_URL=${SQLITE_URL}" > .env
    echo "SQLite active. Restart the dev server."
    ;;
  *)
    sed -n '2,12p' "$0"
    ;;
esac
