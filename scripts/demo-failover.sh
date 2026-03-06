#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Failover Demo — OpenClaw Native ───
# Simulates a primary failure and lets OpenClaw handle the recovery.
# All detection, analysis, and routing updates go through OpenClaw.

OPENCLAW_URL="http://localhost:3100"
WEBHOOK_SECRET="clawsql-webhook-secret"

echo "╔══════════════════════════════════════════╗"
echo "║     ClawSQL — Failover Demo via OpenClaw ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Step 1: Show current state (for reference only)
echo "▶ [1/6] Current state (via direct query for demo display):"
echo ""
echo "  ProxySQL routing:"
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
  -e "SELECT hostgroup_id, hostname, port, status FROM mysql_servers;" 2>/dev/null || echo "  (ProxySQL unavailable)"
echo ""

# Step 2: Notify OpenClaw BEFORE the failure
echo "▶ [2/6] Notifying OpenClaw of impending failover test..."
echo ""

curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d '{"skill":"mysql-failover-test","request":"starting failover test, monitor for primary failure and handle recovery"}' \
  && echo "  ✓ OpenClaw notified of failover test" || echo "  ⚠️  Could not notify OpenClaw"

echo ""

# Step 3: Write test data
echo "▶ [3/6] Writing test data to primary..."
docker exec clawsql-primary mysql -uroot -proot_pass -e \
  "CREATE DATABASE IF NOT EXISTS demo; INSERT INTO demo.ping (src) VALUES ('before-failover');" 2>/dev/null \
  && echo "  ✓ Row inserted" || echo "  ⚠️  Could not insert test data"
sleep 2

# Step 4: Kill the primary
echo ""
echo "▶ [4/6] Stopping MySQL primary (simulating crash)..."
docker stop clawsql-primary
echo "  ✓ Primary stopped"
echo ""
echo "  ⚠️  Primary has failed. OpenClaw should detect and handle recovery."
echo ""
echo "  Waiting 30 seconds for OpenClaw to detect and respond..."
echo ""

# Progress bar
for i in $(seq 1 30); do
  printf "\r  [%-30s] %d/30s" "$(printf '#%.0s' $(seq 1 $i))" "$i"
  sleep 1
done
echo ""
echo ""

# Step 5: Check results
echo "▶ [5/6] Post-failover state:"
echo ""
echo "  ProxySQL routing (updated by OpenClaw):"
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
  -e "SELECT hostgroup_id, hostname, port, status FROM mysql_servers;" 2>/dev/null || echo "  (ProxySQL unavailable)"
echo ""

echo "  Remaining nodes:"
for node in clawsql-replica-1 clawsql-replica-2; do
  ro=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@read_only;" 2>/dev/null || echo "?")
  sid=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@server_id;" 2>/dev/null || echo "?")
  echo "    $node: server_id=$sid read_only=$ro"
done
echo ""

# Step 6: Request analysis from OpenClaw
echo "▶ [6/6] Requesting post-failover analysis from OpenClaw..."
echo ""

curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d '{"skill":"mysql-failover-analysis","request":"analyze failover results and confirm new topology"}' \
  | python3 -m json.tool 2>/dev/null \
  && echo "  ✓ Analysis requested" || echo "  ⚠️  Could not get analysis from OpenClaw"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Failover test complete"
echo ""
echo "To restore the old primary:"
echo "  docker start clawsql-primary"
echo "  # It will rejoin as a replica automatically"
echo ""
echo "For full details on OpenClaw's handling:"
echo "  Open $OPENCLAW_URL and review the conversation log"
echo ""
