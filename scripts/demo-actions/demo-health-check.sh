#!/usr/bin/env bash

# ═══════════════════════════════════════════════════════
#  ClawSQL Demo: Quick Health Check
# ═══════════════════════════════════════════════════════

echo "╔════════════════════════════════════════════════════════╗"
echo "║  ClawSQL Demo: Cluster Health Check                    ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Get Orchestrator topology
echo "📊 Cluster Topology from Orchestrator:"
TOPOLOGY=$(curl -sf "http://localhost:3000/api/clusters" 2>/dev/null || echo '[]')
echo "   Clusters: $TOPOLOGY"
echo ""

# Get ProxySQL status
echo "📊 ProxySQL Server Status:"
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "SELECT hostgroup_id, hostname, port, status FROM mysql_servers ORDER BY hostgroup_id, hostname;" 2>&1 | grep -v "Emulate\|Warning\|>>>>" || echo "   Could not fetch ProxySQL status"
echo ""

# Get replication status
echo "📊 Replication Status:"
docker exec clawsql-replica-1 mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>&1 | grep -E "Slave_(IO|SQL)_Running|Seconds_Behind_Master" | awk '{print "   clawsql-replica-1: "$1, $2}' | head -3
docker exec clawsql-replica-2 mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>&1 | grep -E "Slave_(IO|SQL)_Running|Seconds_Behind_Master" | awk '{print "   clawsql-replica-2: "$1, $2}' | head -3
echo ""

# Summary
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Interact with OpenClaw AI Agent                       ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "Send a webhook to OpenClaw for AI-powered analysis:"
echo ""
echo "  # Health check request:"
echo "  curl -X POST http://localhost:3100/hooks/agent \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'Authorization: Bearer clawsql-webhook-secret' \\"
echo "    -d '{\"skill\":\"mysql-health\",\"request\":\"check cluster health\"}'"
echo ""
echo "  # Topology request:"
echo "  curl -X POST http://localhost:3100/hooks/agent \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'Authorization: Bearer clawsql-webhook-secret' \\"
echo "    -d '{\"skill\":\"mysql-topology\",\"request\":\"show replication topology\"}'"
echo ""
echo "  # Switchover demo (promotes replica-1):"
echo "  bash scripts/demo-actions/demo-switchover.sh"
echo ""
echo "  # Full interactive menu:"
echo "  bash scripts/demo-runner.sh"
echo ""
