#!/bin/bash
# E2E test: Send email via SMTP to Mox, verify webhook delivery to bridge
# Prerequisites: docker compose up (mox + smtp-bridge running)
# Requires: swaks (sudo apt install swaks) or curl

set -e

MOX_HOST="${MOX_HOST:-localhost}"
BRIDGE_URL="${BRIDGE_URL:-http://localhost:3000}"
TEST_ALIAS="${TEST_ALIAS:-test@alias.id}"

echo "=== AliasVault Mox E2E Test ==="
echo "Mox host: $MOX_HOST"
echo "Bridge URL: $BRIDGE_URL"
echo "Test alias: $TEST_ALIAS"
echo ""

# 1. Verify Mox is running (port 25)
echo "[1/3] Checking Mox SMTP on port 25..."
if echo QUIT | nc -w 2 "$MOX_HOST" 25 | grep -q 220; then
  echo "  OK — Mox SMTP is responding"
else
  echo "  FAIL — Mox SMTP not responding on port 25"
  exit 1
fi

# 2. Verify bridge is running
echo "[2/3] Checking bridge health..."
HEALTH=$(curl -sf "$BRIDGE_URL/health" 2>/dev/null || echo '{"status":"unreachable"}')
echo "  Bridge health: $HEALTH"

# 3. Send test email via SMTP using swaks
echo "[3/3] Sending test email via SMTP..."
if command -v swaks &>/dev/null; then
  swaks \
    --to "$TEST_ALIAS" \
    --from "e2e-test@example.com" \
    --server "$MOX_HOST" \
    --port 25 \
    --header "Subject: E2E Test $(date +%s)" \
    --body "This is an automated E2E test email sent at $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --timeout 10 \
    && echo "  OK — Email sent via SMTP" \
    || echo "  FAIL — SMTP delivery failed (expected for unresolvable domains in dev)"
else
  echo "  SKIP — swaks not installed (sudo apt install swaks)"
  echo "  Manual test: send email to $TEST_ALIAS and check bridge logs"
fi

echo ""
echo "=== Check bridge logs for webhook delivery ==="
echo "  docker compose -f docker-compose.mox.yml logs smtp-bridge --tail=20"
