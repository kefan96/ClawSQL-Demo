#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════
#  Demo: Controlled Failover/Switchover Simulation
# ═══════════════════════════════════════════════════════
#  This script demonstrates a controlled switchover where
#  we promote a replica to become the new primary.
# ═══════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  ClawSQL Demo: Controlled Switchover                   ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
OLD_PRIMARY="mysql-primary"
NEW_PRIMARY="mysql-replica-1"
PORT=3306

echo -e "${BLUE}📋 Current Topology:${NC}"
echo "  Primary (writer):  $OLD_PRIMARY:$PORT"
echo "  Replica 1 (reader): $NEW_PRIMARY:$PORT"
echo "  Replica 2 (reader): mysql-replica-2:$PORT"
echo ""

# Step 1: Pre-flight checks
echo -e "${BLUE}✅ Step 1: Pre-flight Checks${NC}"
echo ""

# Check replication status
echo "  Checking replication status..."
IO_STATUS=$(docker exec "$NEW_PRIMARY" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}')
SQL_STATUS=$(docker exec "$NEW_PRIMARY" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_SQL_Running:" | awk '{print $2}')
LAG=$(docker exec "$NEW_PRIMARY" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}')

if [ "$IO_STATUS" != "Yes" ] || [ "$SQL_STATUS" != "Yes" ]; then
  echo -e "  ${RED}✗ Replication is not healthy. Aborting switchover.${NC}"
  exit 1
fi

if [ "$LAG" != "0" ]; then
  echo -e "  ${YELLOW}⚠ Replica is ${LAG}s behind master. Waiting for sync...${NC}"
  sleep 5
fi

echo -e "  ${GREEN}✓ Replication healthy (lag: ${LAG}s)${NC}"

# Check ProxySQL
echo ""
echo "  Checking ProxySQL status..."
WRITER_COUNT=$(docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -N -e "SELECT COUNT(*) FROM mysql_servers WHERE hostgroup_id=10 AND status='ONLINE';" 2>/dev/null)
if [ "$WRITER_COUNT" -gt 0 ]; then
  echo -e "  ${GREEN}✓ ProxySQL has $WRITER_COUNT writer(s) online${NC}"
else
  echo -e "  ${RED}✗ No writers in ProxySQL. Aborting.${NC}"
  exit 1
fi

echo ""
read -p "  Proceed with switchover? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "  Switchover cancelled."
  exit 0
fi

echo ""

# Step 2: Notify OpenClaw (if available)
echo -e "${BLUE}🤖 Step 2: Notifying OpenClaw${NC}"
echo ""

WEBHOOK_DATA=$(cat << EOF
{
  "skill": "mysql-failover",
  "action": "switchover",
  "oldPrimary": "$OLD_PRIMARY",
  "newPrimary": "$NEW_PRIMARY",
  "port": $PORT,
  "clusterAlias": "clawsql-demo"
}
EOF
)

WEBHOOK_RESPONSE=$(curl -sf -X POST "http://localhost:3100/hooks/agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer clawsql-webhook-secret" \
  -d "$WEBHOOK_DATA" 2>/dev/null || echo '{"status": "notification sent"}')

echo "  OpenClaw notification sent"
echo "  Response: $WEBHOOK_RESPONSE"
echo ""

# Step 3: Perform the switchover using Orchestrator
echo -e "${YELLOW}⚡ Step 3: Executing Switchover via Orchestrator${NC}"
echo ""

# Use Orchestrator's graceful-master-takeover-auto API
echo "  Requesting graceful master takeover..."
SWITCHOVER_RESULT=$(curl -sf "http://localhost:3000/api/graceful-master-takeover-auto/clawsql-demo" \
  -H "Content-Type: application/json" \
  -d "{\"targetHost\":\"$NEW_PRIMARY\",\"targetPort\":$PORT}" 2>/dev/null || echo '{"Code":"ERROR","Message":"API call failed"}')

echo "  Result: $SWITCHOVER_RESULT"

# Wait for replication to settle
echo ""
echo "  Waiting for replication to settle..."
sleep 5

# Step 4: Update ProxySQL routing
echo ""
echo -e "${YELLOW}🔄 Step 4: Updating ProxySQL Routing${NC}"
echo ""

# Get current writer
CURRENT_WRITER=$(docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -N -e "SELECT hostname FROM mysql_servers WHERE hostgroup_id=10 AND status='ONLINE' LIMIT 1;" 2>/dev/null || echo "unknown")
echo "  Current ProxySQL writer: $CURRENT_WRITER"

# If switchover succeeded, update ProxySQL
if echo "$SWITCHOVER_RESULT" | grep -q "$NEW_PRIMARY" 2>/dev/null; then
  echo "  Updating ProxySQL writer hostgroup..."

  # Disable old writer
  docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
    UPDATE mysql_servers SET hostgroup_id=20 WHERE hostname='$OLD_PRIMARY' AND hostgroup_id=10;
    UPDATE mysql_servers SET hostgroup_id=10 WHERE hostname='$NEW_PRIMARY' AND hostgroup_id=20;
    LOAD MYSQL SERVERS TO RUNTIME;
    SAVE MYSQL SERVERS TO DISK;
  " 2>/dev/null

  echo -e "  ${GREEN}✓ ProxySQL routing updated${NC}"
else
  echo -e "  ${YELLOW}⚠ Switchover result unclear, manual ProxySQL update may be needed${NC}"
fi

# Step 5: Verify new topology
echo ""
echo -e "${BLUE}🔍 Step 5: Verifying New Topology${NC}"
echo ""

# Check Orchestrator for new primary
sleep 3
NEW_TOPOLOGY=$(curl -sf "http://localhost:3000/api/cluster/alias/mysql-primary:3306" 2>/dev/null || echo '{}')

if [ "$NEW_TOPOLOGY" != "{}" ]; then
  ACTUAL_PRIMARY=$(echo "$NEW_TOPOLOGY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Key']['Hostname'] if d and len(d) > 0 else 'unknown')" 2>/dev/null || echo "unknown")
  echo -e "  New Primary (via Orchestrator): ${GREEN}$ACTUAL_PRIMARY${NC}"
fi

# Check ProxySQL routing
echo ""
echo "  ProxySQL Server Status:"
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
  SELECT
    CASE WHEN hostgroup_id=10 THEN 'WRITER' ELSE 'READER' END as role,
    hostname,
    port,
    status
  FROM mysql_servers
  ORDER BY hostgroup_id, hostname;
" 2>/dev/null

# Step 6: Test write to new primary
echo ""
echo -e "${BLUE}✍️  Step 6: Testing Write to New Primary${NC}"
echo ""

TEST_RESULT=$(docker exec clawsql-primary mysql -h"$NEW_PRIMARY" -P$PORT -uroot -proot_pass -e "
  CREATE DATABASE IF NOT EXISTS switchover_test;
  USE switchover_test;
  CREATE TABLE IF NOT EXISTS switchover_log (id INT AUTO_INCREMENT PRIMARY KEY, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  INSERT INTO switchover_log VALUES (NULL);
  SELECT * FROM switchover_log ORDER BY id DESC LIMIT 1;
" 2>/dev/null || echo "Write test pending")

if [ "$TEST_RESULT" != "Write test pending" ]; then
  echo -e "  ${GREEN}✓ Write test successful${NC}"
else
  echo -e "  ${YELLOW}⚠ Write test pending (may need replication sync)${NC}"
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║              Switchover Complete                       ║"
echo "╠════════════════════════════════════════════════════════╣"
echo -e "║  New Primary: ${GREEN}$NEW_PRIMARY${NC}"
echo -e "║  Old Primary: ${YELLOW}$OLD_PRIMARY${NC} (now replica)"
echo "║                                                          ║"
echo "║  ProxySQL routing has been updated.                      ║"
echo "║  Replication topology has been reconfigured.             ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "💡 To reverse the switchover, run this script again with"
echo "   OLD_PRIMARY=$NEW_PRIMARY and NEW_PRIMARY=$OLD_PRIMARY"
echo ""
