#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# DukaFlow - env-aware Prisma client generation.
#
# Runs as the package.json "postinstall" hook so Vercel (and any CI) always
# ships a Prisma client that matches the DATABASE_URL provider:
#   - postgresql://... -> prisma/schema.postgres.prisma (Supabase / Neon)
#   - anything else    -> prisma/schema.prisma          (SQLite sandbox)
#
# Why: Vercel's npm allow-scripts guard skips @prisma/client's own postinstall,
# so without this hook the cloud build ships a stub client and every API
# route 500s at runtime.
# -----------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*)
    echo "[prisma-generate] postgres DATABASE_URL detected -> generating client from prisma/schema.postgres.prisma"
    prisma generate --schema prisma/schema.postgres.prisma
    ;;
  *)
    echo "[prisma-generate] sqlite/default -> generating client from prisma/schema.prisma"
    prisma generate --schema prisma/schema.prisma
    ;;
esac
