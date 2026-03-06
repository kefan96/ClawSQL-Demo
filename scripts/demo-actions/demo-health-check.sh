#!/usr/bin/env bash

# ═══════════════════════════════════════════════════════
#  ClawSQL Demo: Quick Health Check — OpenClaw Native
# ═══════════════════════════════════════════════════════
#  This script shows how to request health checks via OpenClaw.
#  All analysis is done by OpenClaw, not direct commands.

OPENCLAW_URL="http://localhost:3100"
WEBHOOK_SECRET="clawsql-webhook-secret"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  ClawSQL Demo: Health Check via OpenClaw               ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

echo "📊 Requesting health check from OpenClaw..."
echo ""
echo "This request goes through OpenClaw — the only interface."
echo ""

RESPONSE=$(curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d '{"skill":"mysql-health","request":"check cluster health, analyze replication status, and report findings"}' 2>/dev/null)

if [ -n "$RESPONSE" ]; then
  echo "Response from OpenClaw:"
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
else
  echo "⚠️  OpenClaw did not respond. Make sure it's running at $OPENCLAW_URL"
  echo ""
  echo "To start OpenClaw:"
  echo "  docker compose up -d openclaw"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 For the full analysis, check the OpenClaw UI at:"
echo "   $OPENCLAW_URL"
echo ""
echo "OpenClaw will:"
echo "  1. Fetch topology from Orchestrator"
echo "  2. Check replication status on all replicas"
echo "  3. Verify ProxySQL routing"
echo "  4. Provide AI-powered analysis and recommendations"
echo ""
