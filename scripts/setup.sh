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

# Step 4: Configure replication
echo "▶ Configuring replication..."

# Create replication user on primary
echo "  Creating replication user on primary..."
docker exec clawsql-primary mysql -uroot -proot_pass -e "
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl_pass';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;
" 2>/dev/null

for replica in clawsql-replica-1 clawsql-replica-2; do
  echo "  Setting up replication on $replica..."
  # Stop any existing replication (ignore errors if not running)
  docker exec "$replica" mysql -uroot -proot_pass -e "STOP SLAVE;" 2>/dev/null || true
  docker exec "$replica" mysql -uroot -proot_pass -e "RESET SLAVE ALL;" 2>/dev/null || true
  # Configure replication with SSL
  docker exec "$replica" mysql -uroot -proot_pass -e "
CHANGE MASTER TO
  MASTER_HOST='mysql-primary',
  MASTER_PORT=3306,
  MASTER_USER='repl',
  MASTER_PASSWORD='repl_pass',
  MASTER_AUTO_POSITION=1,
  MASTER_SSL=1;
START SLAVE;
" 2>/dev/null || true
done

# Wait for replication to connect
echo "  Waiting for replication to initialize..."
sleep 5

# Verify replication
for replica in clawsql-replica-1 clawsql-replica-2; do
  io_running=$(docker exec "$replica" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}')
  sql_running=$(docker exec "$replica" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_SQL_Running:" | awk '{print $2}')
  lag=$(docker exec "$replica" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}')
  echo "  $replica: IO=$io_running SQL=$sql_running Lag=${lag}s"
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

# Step 8: Configure ProxySQL users
echo "▶ Configuring ProxySQL..."
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
INSERT OR REPLACE INTO mysql_users (username, password, default_hostgroup, active) VALUES ('root', 'root_pass', 10, 1);
INSERT OR REPLACE INTO mysql_users (username, password, default_hostgroup, active) VALUES ('app', 'app_pass', 10, 1);
LOAD MYSQL USERS TO RUNTIME;
SAVE MYSQL USERS TO DISK;
" 2>/dev/null
echo "  ✓ ProxySQL users configured"

# Step 9: Verify ProxySQL
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
