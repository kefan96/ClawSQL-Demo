#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════
#  ClawSQL Demo Runner — OpenClaw Native
# ═══════════════════════════════════════════════════════
#  All interactions go through OpenClaw via natural language.
#  This script just launches OpenClaw and provides examples.
# ═══════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OPENCLAW_URL="http://localhost:3100"
WEBHOOK_SECRET="clawsql-webhook-secret"

echo "╔════════════════════════════════════════════════════════╗"
echo "║        ClawSQL Demo — OpenClaw Native Interface        ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Check if OpenClaw is running
if ! curl -sf "$OPENCLAW_URL" > /dev/null 2>&1; then
  echo "⚠️  OpenClaw is not running at $OPENCLAW_URL"
  echo ""
  echo "To start OpenClaw, run:"
  echo "  docker compose up -d openclaw"
  echo ""
  echo "Then re-run this demo script."
  exit 1
fi

echo "✅ OpenClaw is available at $OPENCLAW_URL"
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  How to Interact                                       ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "  All demo interactions go through OpenClaw using natural language."
echo "  OpenClaw is the ONLY interface — no direct MySQL/ProxySQL commands."
echo ""
echo "  Open the UI: $OPENCLAW_URL"
echo ""
echo "  Or send webhook requests:"
echo ""

send_example() {
  local name="$1"
  local skill="$2"
  local request="$3"
  echo "  ── $name"
  echo "  curl -X POST $OPENCLAW_URL/hooks/agent \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -H 'Authorization: Bearer $WEBHOOK_SECRET' \\"
  echo "    -d '{\"skill\":\"$skill\",\"request\":\"$request\"}'"
  echo ""
}

send_example "📊 Health Check" "mysql-health" "check cluster health and analyze replication status"
send_example "🔄 Switchover Demo" "mysql-switchover" "promote mysql-replica-1 to primary with graceful switchover"
send_example "👁️  View Topology" "mysql-topology" "show current replication topology"
send_example "📝 Test RW Splitting" "mysql-rw-test" "test read/write splitting through ProxySQL"
send_example "🔍 Check Replication Lag" "mysql-lag" "monitor replication lag on all replicas"
send_example "🚨 Simulate Failover" "mysql-failover" "stop the primary and handle automatic failover"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  Natural Language Examples                             ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "  You can also just talk to OpenClaw naturally:"
echo ""
echo "    'Show me the current MySQL topology'"
echo "    'Is replication healthy right now?'"
echo "    'Switch over to replica-1'"
echo "    'What's the replication lag on replica-2?'"
echo "    'Run a failover test'"
echo ""
echo "  OpenClaw will understand and execute the appropriate actions."
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Quick Actions                                         ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "  1) Send a health check webhook"
echo "  2) View current topology"
echo "  3) Open OpenClaw UI in browser"
echo "  0) Exit"
echo ""
read -p "Enter your choice [0-3]: " choice || true

case $choice in
  1)
    echo ""
    echo "Sending health check request to OpenClaw..."
    curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $WEBHOOK_SECRET" \
      -d '{"skill":"mysql-health","request":"check cluster health and provide analysis"}' \
      | python3 -m json.tool 2>/dev/null || echo "Request sent"
    echo ""
    echo "💡 Check $OPENCLAW_URL for the response"
    ;;
  2)
    echo ""
    echo "Requesting topology from OpenClaw..."
    curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $WEBHOOK_SECRET" \
      -d '{"skill":"mysql-topology","request":"show current replication topology"}' \
      | python3 -m json.tool 2>/dev/null || echo "Request sent"
    echo ""
    echo "💡 Check $OPENCLAW_URL for the response"
    ;;
  3)
    echo "Opening OpenClaw UI..."
    if command -v xdg-open &> /dev/null; then
      xdg-open "$OPENCLAW_URL"
    elif command -v open &> /dev/null; then
      open "$OPENCLAW_URL"
    else
      echo "Open $OPENCLAW_URL in your browser"
    fi
    ;;
  0)
    echo "Goodbye!"
    exit 0
    ;;
  *)
    echo "Just use the OpenClaw UI at $OPENCLAW_URL"
    ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Remember: OpenClaw is your only interface."
echo "All operations go through it via natural language or webhooks."
echo ""
