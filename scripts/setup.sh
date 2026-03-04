#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Setup Script ───
# Brings up the full stack and waits for all components to be ready.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║        ClawSQL MVP — Setup               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Step 1: Start infrastructure
echo "▶ Starting containers..."
docker compose up -d

# Step 2: Wait for MySQL primary
echo "▶ Waiting for MySQL primary..."
until docker exec clawsql-primary mysqladmin ping -uroot -proot_pass --silent 2>/dev/null; do
  sleep 2
done
echo "  ✓ MySQL primary is ready"

# Step 3: Wait for replicas
echo "▶ Waiting for replicas..."
for replica in clawsql-replica-1 clawsql-replica-2; do
  until docker exec "$replica" mysqladmin ping -uroot -proot_pass --silent 2>/dev/null; do
    sleep 2
  done
  echo "  ✓ $replica is ready"
done

# Step 4: Verify replication
echo "▶ Checking replication..."
sleep 5
for replica in clawsql-replica-1 clawsql-replica-2; do
  io_running=$(docker exec "$replica" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}')
  sql_running=$(docker exec "$replica" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_SQL_Running:" | awk '{print $2}')
  echo "  $replica: IO=$io_running SQL=$sql_running"
done

# Step 5: Wait for Orchestrator
echo "▶ Waiting for Orchestrator..."
until curl -sf http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 3
done
echo "  ✓ Orchestrator is ready"

# Step 6: Discover instances in Orchestrator
echo "▶ Discovering MySQL instances in Orchestrator..."
curl -sf "http://localhost:3000/api/discover/mysql-primary/3306" > /dev/null 2>&1 || true
sleep 3
curl -sf "http://localhost:3000/api/discover/mysql-replica-1/3306" > /dev/null 2>&1 || true
curl -sf "http://localhost:3000/api/discover/mysql-replica-2/3306" > /dev/null 2>&1 || true
echo "  ✓ Instances submitted for discovery"

# Wait for Orchestrator to poll
echo "  Waiting for topology to populate..."
sleep 10

# Step 7: Show topology
echo ""
echo "▶ Current topology:"
curl -sf "http://localhost:3000/api/cluster/alias/clawsql-demo" 2>/dev/null | python3 -m json.tool 2>/dev/null || \
  curl -sf "http://localhost:3000/api/clusters" 2>/dev/null || \
  echo "  (topology still populating, check Orchestrator UI at http://localhost:3000)"

# Step 8: Verify ProxySQL
echo ""
echo "▶ ProxySQL server list:"
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
  -e "SELECT hostgroup_id, hostname, port, status FROM mysql_servers;" 2>/dev/null || \
  echo "  (ProxySQL still initializing)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║            Setup Complete!               ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║  MySQL Primary:  localhost:3307           ║"
echo "║  Replica 1:      localhost:3308           ║"
echo "║  Replica 2:      localhost:3309           ║"
echo "║  ProxySQL:       localhost:6033 (mysql)   ║"
echo "║  ProxySQL Admin: localhost:6032           ║"
echo "║  Orchestrator:   http://localhost:3000    ║"
echo "║  OpenClaw:       http://localhost:3100    ║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
