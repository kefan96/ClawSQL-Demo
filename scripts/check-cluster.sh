#!/usr/bin/env bash
set -euo pipefail

# ─── Check Cluster Health — OpenClaw Native ───
# All health checks go through OpenClaw as the single interface.
# Direct queries are only used for fallback diagnostics.

OPENCLAW_URL="http://localhost:3100"
WEBHOOK_SECRET="clawsql-webhook-secret"

echo "╔══════════════════════════════════════════╗"
echo "║     ClawSQL — Cluster Health Check       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check if OpenClaw is available
if curl -sf "$OPENCLAW_URL" > /dev/null 2>&1; then
  echo "✅ OpenClaw is available at $OPENCLAW_URL"
  echo ""
  echo "▶ Requesting AI-powered health analysis from OpenClaw..."
  echo ""

  RESPONSE=$(curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $WEBHOOK_SECRET" \
    -d '{"skill":"mysql-health","request":"check cluster health, analyze replication status, and provide recommendations"}' 2>/dev/null)

  if [ -n "$RESPONSE" ]; then
    echo "OpenClaw Analysis:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    echo ""
    echo "💡 For full conversation, check: $OPENCLAW_URL"
  else
    echo "⚠️  OpenClaw did not respond. Falling back to direct checks..."
    echo ""
    fallthrough=true
  fi
else
  echo "⚠️  OpenClaw is not running. Falling back to direct checks..."
  echo ""
  fallthrough=true
fi

# Fallback: Direct health checks (for debugging or when OpenClaw unavailable)
if [ "${fallthrough:-false}" = true ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Orchestrator
  echo "Orchestrator:"
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "  ✓ Reachable"
    clusters=$(curl -sf http://localhost:3000/api/clusters 2>/dev/null)
    echo "  Clusters: $clusters"
  else
    echo "  ✗ Unreachable"
  fi
  echo ""

  # ProxySQL
  echo "ProxySQL:"
  if docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "SELECT 1" > /dev/null 2>&1; then
    echo "  ✓ Admin interface reachable"
    echo "  Servers:"
    docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
      -e "SELECT hostgroup_id hg, hostname, port, status FROM mysql_servers;" 2>/dev/null
  else
    echo "  ✗ Unreachable"
  fi
  echo ""

  # MySQL instances
  echo "MySQL Instances:"
  for node in clawsql-primary clawsql-replica-1 clawsql-replica-2; do
    if docker exec "$node" mysqladmin ping -uroot -proot_pass --silent 2>/dev/null; then
      ro=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@read_only;" 2>/dev/null)
      sid=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@server_id;" 2>/dev/null)
      role=$( [ "$ro" = "0" ] && echo "writer" || echo "reader" )
      echo "  ✓ $node: server_id=$sid role=$role"
    else
      echo "  ✗ $node: not reachable"
    fi
  done
  echo ""

  # Replication
  echo "Replication:"
  for replica in clawsql-replica-1 clawsql-replica-2; do
    status=$(docker exec "$replica" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null)
    if [ -n "$status" ]; then
      io=$(echo "$status" | grep "Slave_IO_Running:" | awk '{print $2}')
      sql=$(echo "$status" | grep "Slave_SQL_Running:" | awk '{print $2}')
      lag=$(echo "$status" | grep "Seconds_Behind_Master:" | awk '{print $2}')
      echo "  $replica: IO=$io SQL=$sql Lag=${lag}s"
    else
      echo "  $replica: no replication status"
    fi
  done
  echo ""

  # OpenClaw
  echo "OpenClaw:"
  if curl -sf "$OPENCLAW_URL" > /dev/null 2>&1; then
    echo "  ✓ Reachable at $OPENCLAW_URL"
  else
    echo "  ✗ Unreachable"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Tip: OpenClaw is your primary interface for all operations."
echo "   Try: curl -X POST $OPENCLAW_URL/hooks/agent \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -H 'Authorization: Bearer $WEBHOOK_SECRET' \\"
echo "     -d '{\"skill\":\"mysql-health\",\"request\":\"analyze cluster\"}'"
echo ""
