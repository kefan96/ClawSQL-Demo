#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Failover Demo ───
# Simulates a primary failure and shows the hook → skill → routing update flow.

echo "╔══════════════════════════════════════════╗"
echo "║     ClawSQL — Failover Demo              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Step 1: Show current state
echo "▶ [1/6] Current ProxySQL routing:"
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
  -e "SELECT hostgroup_id, hostname, port, status FROM mysql_servers;" 2>/dev/null
echo ""

echo "▶ [2/6] Current replication topology:"
for node in clawsql-primary clawsql-replica-1 clawsql-replica-2; do
  ro=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@read_only;" 2>/dev/null)
  sid=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@server_id;" 2>/dev/null)
  echo "  $node: server_id=$sid read_only=$ro"
done
echo ""

# Step 2: Write test data
echo "▶ [3/6] Writing test data to primary..."
docker exec clawsql-primary mysql -uroot -proot_pass -e \
  "INSERT INTO demo.ping (src) VALUES ('before-failover');" 2>/dev/null
echo "  ✓ Row inserted"
sleep 2

# Step 3: Verify replication
echo ""
echo "▶ [4/6] Verifying replication sync..."
for replica in clawsql-replica-1 clawsql-replica-2; do
  count=$(docker exec "$replica" mysql -uroot -proot_pass -N -e \
    "SELECT COUNT(*) FROM demo.ping WHERE src='before-failover';" 2>/dev/null)
  echo "  $replica: replicated=$count"
done
echo ""

# Step 4: Kill the primary
echo "▶ [5/6] Stopping MySQL primary (simulating crash)..."
docker stop clawsql-primary
echo "  ✓ Primary stopped"
echo ""
echo "  Orchestrator will detect the failure in ~5-10 seconds."
echo "  It will then POST a webhook to OpenClaw at /hooks/agent"
echo "  OpenClaw's mysql-failover skill will update ProxySQL routing."
echo ""
echo "  Waiting 30 seconds for automatic recovery..."

# Progress bar
for i in $(seq 1 30); do
  printf "\r  [%-30s] %d/30s" "$(printf '#%.0s' $(seq 1 $i))" "$i"
  sleep 1
done
echo ""
echo ""

# Step 5: Check results
echo "▶ [6/6] Post-failover state:"
echo ""
echo "  ProxySQL routing:"
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
  -e "SELECT hostgroup_id, hostname, port, status FROM mysql_servers;" 2>/dev/null
echo ""

echo "  Orchestrator topology:"
curl -sf "http://localhost:3000/api/cluster/alias/clawsql-demo" 2>/dev/null | python3 -m json.tool 2>/dev/null || \
  echo "  (check Orchestrator UI at http://localhost:3000)"
echo ""

echo "  Remaining nodes:"
for node in clawsql-replica-1 clawsql-replica-2; do
  ro=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@read_only;" 2>/dev/null || echo "?")
  sid=$(docker exec "$node" mysql -uroot -proot_pass -N -e "SELECT @@server_id;" 2>/dev/null || echo "?")
  echo "    $node: server_id=$sid read_only=$ro"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To restore the old primary:"
echo "  docker start clawsql-primary"
echo "  # It will rejoin as a replica automatically"
echo ""
echo "To check OpenClaw's handling of the failover:"
echo "  Open http://localhost:3100 and review the conversation log"
echo ""
