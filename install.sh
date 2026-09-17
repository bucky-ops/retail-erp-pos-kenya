#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# DukaFlow — retail-erp-pos-kenya one-shot installer
# Bootstraps DB, installs deps, seeds Kenyan demo data, starts dev.
# Usage: bash install.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

echo "🏪 DukaFlow — Kenya Retail ERP + POS installer"

# 1. runtime check (bun preferred, npm/node fallback)
if command -v bun >/dev/null 2>&1; then
  PKG="bun"
elif command -v npm >/dev/null 2>&1; then
  PKG="npm"
else
  echo "❌ Need bun or node+npm installed. https://bun.sh" && exit 1
fi
echo "▶ Using package manager: $PKG"

# 2. deps
if [ "$PKG" = "bun" ]; then bun install; else npm install; fi

# 3. env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "▶ Created .env from .env.example"
fi

# 4. database schema
if [ "$PKG" = "bun" ]; then bun run db:push; else npm run db:push; fi

# 5. seed
if [ "$PKG" = "bun" ]; then bun prisma/seed.ts; else npx tsx prisma/seed.ts; fi

# 6. build check (optional) then start dev
echo "✅ Setup complete. Starting dev server on http://localhost:3000 ..."
if [ "$PKG" = "bun" ]; then bun run dev; else npm run dev; fi
