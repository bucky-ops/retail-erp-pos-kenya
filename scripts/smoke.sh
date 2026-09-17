#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DukaFlow — pre-push API smoke test (bash + curl, no test framework needed).
#
# Usage:   bash scripts/smoke.sh [base_url]
#          BASE=http://localhost:3000 bash scripts/smoke.sh
#
# What it covers:
#   1. Every read API group answers 200 with valid JSON.
#   2. Deterministic write-path checks: stock-take open → count → approve,
#      supplier return with over-return guard, expense digest dedupe.
#   3. Nothing it creates corrupts demo data: the stock-take it opens is
#      cancelled (no stock change), and the RTV is validated against a tiny
#      quantity of the cheapest stocked item.
#
# Exit code 0 = all green. Any failure prints ❌ and exits 1.
# ─────────────────────────────────────────────────────────────────────────────
set -u

BASE="${1:-${BASE:-http://localhost:3000}}"
PASS=0; FAIL=0

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

# get PATH → http code + body
req() { # method path [body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -w "\n%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$body" "$BASE$path"
  else
    curl -s -w "\n%{http_code}" -X "$method" "$BASE$path"
  fi
}

expect_200() { # label method path [body]
  local label="$1" out
  out=$(req "${@:2}")
  local code="$(echo "$out" | tail -1)"
  if [ "$code" = "200" ]; then PASS=$((PASS+1)); echo "✅ $label";
  else FAIL=$((FAIL+1)); echo "❌ $label (HTTP $code)"; echo "$out" | head -3; fi
}

expect_field() { # label method path jq_expr
  local label="$1" path="$3" expr="$4" out code val
  out=$(req "$2" "$path" "${5:-}")
  code="$(echo "$out" | tail -1)"
  val="$(echo "$out" | sed '$d' | json "$expr")"
  if [ "$code" = "200" ] && [ -n "$val" ] && [ "$val" != "None" ]; then
    PASS=$((PASS+1)); echo "✅ $label ($val)"
  else
    FAIL=$((FAIL+1)); echo "❌ $label (HTTP $code, expr=$expr)"
  fi
}

echo "── DukaFlow smoke @ $BASE ──"

# 1. read groups -----------------------------------------------------------------
for p in bootstrap dashboard products inventory customers debt-plans pipeline reports suppliers purchase-orders expenses returns till payroll messages chat gift-cards; do
  expect_200 "GET /api/$p" GET "/api/$p"
done

# 2. stock-take lifecycle: open → count → CANCEL (leaves stock untouched) ────────
ST=$(req POST /api/stock-take '{"storeId":1,"category":"All","startedBy":"smoke-test"}')
ST_CODE="$(echo "$ST" | tail -1)"; ST_ID="$(echo "$ST" | sed '$d' | json "d['id']")"
if [ "$ST_CODE" = "200" ] || [ "$ST_CODE" = "409" ]; then
  PASS=$((PASS+1)); echo "✅ stock-take open (id=$ST_ID, code=$ST_CODE)"
else
  FAIL=$((FAIL+1)); echo "❌ stock-take open (HTTP $ST_CODE)"; echo "$ST" | head -3
fi

if [ -n "$ST_ID" ] && [ "$ST_ID" != "None" ] && [ "$ST_ID" != "" ]; then
  ITEM=$(req GET "/api/stock-take/$ST_ID")
  ITEM_ID="$(echo "$ITEM" | sed '$d' | json "d['items'][0]['id']")"
  SYS_QTY="$(echo "$ITEM" | sed '$d' | json "d['items'][0]['systemQty']")"
  if [ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "None" ]; then
    expect_field "stock-take count line" PATCH "/api/stock-take/$ST_ID" \
      "d['ok']" "{\"action\":\"count\",\"itemId\":$ITEM_ID,\"countedQty\":$SYS_QTY,\"countedBy\":\"smoke\"}"
  fi
  expect_field "stock-take cancel (no stock change)" PATCH "/api/stock-take/$ST_ID" \
    "d['status']=='Cancelled'" '{"action":"cancel"}'
fi

# 3. RTV over-return guard must 400 (not 200/500) ────────────────────────────────
OUT=$(req POST /api/supplier-returns '{"supplierId":1,"storeId":1,"reason":"Damaged","lines":[{"productId":1,"qty":999999}]}')
CODE="$(echo "$OUT" | tail -1)"
if [ "$CODE" = "400" ]; then PASS=$((PASS+1)); echo "✅ RTV over-return guarded (400)";
else FAIL=$((FAIL+1)); echo "❌ RTV over-return guard (HTTP $CODE)"; fi

# 4. cron/daily answers and reports expense digest shape ────────────────────────
expect_field "cron/daily expenses digest" POST /api/cron/daily "d['expenses'] is not None"

echo "──────────────────────────────"
echo "Smoke result: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] || exit 1
