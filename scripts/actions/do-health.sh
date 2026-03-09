#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Health Check ───
# Runs comprehensive health check via OpenClaw or directly

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

OPENCLAW_URL="http://localhost:18789"
WEBHOOK_SECRET="clawsql-webhook-secret"

do_health() {
  echo "╔══════════════════════════════════════════╗"
  echo "║     Health Check                         ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  if ! curl -sf "$OPENCLAW_URL" > /dev/null 2>&1; then
    echo "  ⚠ OpenClaw not available at $OPENCLAW_URL"
    echo "  Running local health check instead..."
    bash "$SCRIPT_DIR/../check.sh"
    return 0
  fi

  echo "▶ Sending health check request to OpenClaw..."
  resp=$(curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $WEBHOOK_SECRET" \
    -d '{"skill":"mysql-health","message":"check cluster health and analyze replication"}' 2>/dev/null)

  if [ -n "$resp" ]; then
    runid=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runId','?'))" 2>/dev/null || echo "?")
    echo "  ✓ Request sent (runId: $runid)"
    echo "  → Check results at: $OPENCLAW_URL"
  else
    echo "  ⚠ No response from OpenClaw"
  fi
  echo ""

  echo "▶ Direct health summary:"
  bash "$SCRIPT_DIR/../check.sh" 2>/dev/null | grep -E "^(OpenClaw|Orchestrator|ProxySQL|MySQL|Replication)|✓|✗|Clusters|Topology|Routing|replica" | head -20 || echo "  (health check unavailable)"
}

# Main entry point
do_health
