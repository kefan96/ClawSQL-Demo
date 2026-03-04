#!/usr/bin/env bash
set -euo pipefail

# ─── Check cluster health ───
# Quick script to verify all components are working.

echo "ClawSQL — Cluster Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
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
if curl -sf http://localhost:3100/health > /dev/null 2>&1; then
  echo "  ✓ Reachable at http://localhost:3100"
else
  echo "  ? Check http://localhost:3100 manually"
fi
