#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════
#  ClawSQL Demo: Controlled Switchover — OpenClaw Native
# ═══════════════════════════════════════════════════════
#  All switchover operations go through OpenClaw.
#  OpenClaw handles the orchestration, analysis, and execution.

OPENCLAW_URL="http://localhost:3100"
WEBHOOK_SECRET="clawsql-webhook-secret"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  ClawSQL Demo: Controlled Switchover via OpenClaw      ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

echo "📋 Switchover Request"
echo ""
echo "  This demo promotes mysql-replica-1 to primary."
echo "  All operations are handled by OpenClaw."
echo ""

# Configuration
OLD_PRIMARY="mysql-primary"
NEW_PRIMARY="mysql-replica-1"
PORT="3306"

echo "  Old Primary: $OLD_PRIMARY"
echo "  New Primary: $NEW_PRIMARY"
echo ""

read -p "  Proceed with switchover via OpenClaw? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "  Switchover cancelled."
  exit 0
fi

echo ""
echo "🤖 Sending switchover request to OpenClaw..."
echo ""

WEBHOOK_DATA=$(cat << EOF
{
  "skill": "mysql-switchover",
  "request": "Perform graceful switchover from $OLD_PRIMARY to $NEW_PRIMARY on port $PORT for cluster clawsql-demo"
}
EOF
)

RESPONSE=$(curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d "$WEBHOOK_DATA" 2>/dev/null)

if [ -n "$RESPONSE" ]; then
  echo "OpenClaw Response:"
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
else
  echo "⚠️  OpenClaw did not respond. Check $OPENCLAW_URL for status."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 OpenClaw is handling the switchover:"
echo "   1. Validating replication health"
echo "   2. Executing graceful-master-takeover via Orchestrator"
echo "   3. Updating ProxySQL routing"
echo "   4. Verifying new topology"
echo ""
echo "   Check the OpenClaw UI for live updates: $OPENCLAW_URL"
echo ""
