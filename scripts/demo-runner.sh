#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════
#  ClawSQL Demo Runner
# ═══════════════════════════════════════════════════════
#  Interactive menu for running ClawSQL demos
# ═══════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

show_menu() {
  clear
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║           ClawSQL Demo — Interactive Menu              ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Please select an action:"
  echo ""
  echo "  1) 📊 Cluster Health Check + AI Analysis"
  echo "  2) 🔄 Controlled Switchover Demo"
  echo "  3) 👁️  View Current Topology"
  echo "  4) 📝 Test Read/Write Splitting"
  echo "  5) 🤖 Send Webhook to OpenClaw"
  echo "  6) 📋 View ProxySQL Routing"
  echo "  7) 🔍 Check Replication Lag"
  echo ""
  echo "  0) Exit"
  echo ""
}

health_check() {
  echo ""
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║  Cluster Health Check                                  ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo ""

  # Get topology
  echo "📊 Fetching cluster topology..."
  TOPOLOGY=$(curl -sf "http://localhost:3000/api/cluster/alias/mysql-primary:3306" 2>/dev/null || echo '{}')

  if [ "$TOPOLOGY" != "{}" ]; then
    PRIMARY=$(echo "$TOPOLOGY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Key']['Hostname'] if d else 'unknown')" 2>/dev/null)
    REPLICA_COUNT=$(echo "$TOPOLOGY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d[0].get('Replicas', [])) if d else 0)" 2>/dev/null)
    echo "  Primary: $PRIMARY"
    echo "  Replicas: $REPLICA_COUNT"
  else
    echo "  ⚠️  Could not fetch topology"
  fi

  echo ""
  echo "📊 Checking replication status..."
  for replica in clawsql-replica-1 clawsql-replica-2; do
    io=$(docker exec "$replica" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}')
    sql=$(docker exec "$replica" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_SQL_Running:" | awk '{print $2}')
    lag=$(docker exec "$replica" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}')
    status="✅"
    [ "$io" != "Yes" ] || [ "$sql" != "Yes" ] && status="⚠️"
    echo "  $status $replica: IO=$io SQL=$sql Lag=${lag}s"
  done

  echo ""
  echo "📊 Checking ProxySQL..."
  docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
    SELECT
      CASE WHEN hostgroup_id=10 THEN 'WRITER' ELSE 'READER' END as role,
      hostname,
      port,
      status
    FROM mysql_servers
    ORDER BY hostgroup_id, hostname;
  " 2>/dev/null

  echo ""
  echo "💡 To send this to OpenClaw for AI analysis, run:"
  echo "   curl -X POST http://localhost:3100/hooks/agent \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -H 'Authorization: Bearer clawsql-webhook-secret' \\"
  echo "     -d '{\"skill\":\"mysql-health\",\"request\":\"analyze cluster health\"}'"
  echo ""
  read -p "Press Enter to continue..."
}

view_topology() {
  echo ""
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║  Current MySQL Topology                                ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo ""

  TOPOLOGY=$(curl -sf "http://localhost:3000/api/cluster/alias/mysql-primary:3306" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo '{}')

  if [ "$TOPOLOGY" != "{}" ]; then
    echo "$TOPOLOGY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data:
    primary = data[0]
    print(f\"Primary: {primary['Key']['Hostname']}:{primary['Key']['Port']} (server_id={primary['ServerID']})\")
    print(f\"  Version: {primary['Version']}\")
    print(f\"  GTID Mode: {primary['GTIDMode']}\")
    print()
    replicas = primary.get('Replicas', [])
    if replicas:
        print('Replicas:')
        for r in replicas:
            lag = r.get('ReplicationLagSeconds', {})
            lag_str = f\"{lag.get('Int64', 'N/A')}s\" if lag.get('Valid') else 'N/A'
            print(f\"  ├─ {r['Key']['Hostname']}:{r['Key']['Port']} (server_id={r['ServerID']})\")
            print(f\"  │   Lag: {lag_str}, ReadOnly: {r['ReadOnly']}\")
    else:
        print('No replicas found')
" 2>/dev/null || echo "  Could not parse topology"
  else
    echo "  ⚠️  Could not fetch topology from Orchestrator"
  fi

  echo ""
  read -p "Press Enter to continue..."
}

test_rw_splitting() {
  echo ""
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║  Testing Read/Write Splitting                          ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo ""

  # Write to primary via ProxySQL
  echo "✍️  Writing test data via ProxySQL (should go to writer)..."
  docker exec clawsql-primary mysql -hproxysql -P6033 -uroot -proot_pass -e "
    CREATE DATABASE IF NOT EXISTS demo_test;
    USE demo_test;
    CREATE TABLE IF NOT EXISTS rw_test (id INT AUTO_INCREMENT PRIMARY KEY, value VARCHAR(100), created TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO rw_test (value) VALUES ('test_via_proxysql');
    SELECT * FROM rw_test ORDER BY id DESC LIMIT 3;
  " 2>/dev/null

  echo ""
  echo "📖 Reading from ProxySQL (should go to replica)..."
  docker exec clawsql-primary mysql -hproxysql -P6033 -uroot -proot_pass -e "
    USE demo_test;
    SELECT @@hostname as connected_to, id, value FROM rw_test ORDER BY id DESC LIMIT 3;
  " 2>/dev/null

  echo ""
  echo "📖 Verifying data on actual primary..."
  docker exec clawsql-primary mysql -uroot -proot_pass -e "
    USE demo_test;
    SELECT @@hostname as actual_host, id, value FROM rw_test ORDER BY id DESC LIMIT 3;
  " 2>/dev/null

  echo ""
  read -p "Press Enter to continue..."
}

send_webhook() {
  echo ""
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║  Send Webhook to OpenClaw                              ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo ""

  echo "Select action to send:"
  echo "  1) Health Check Request"
  echo "  2) Topology Request"
  echo "  3) Custom Request"
  echo ""
  read -p "Choose [1-3]: " webhook_choice

  case $webhook_choice in
    1)
      PAYLOAD='{"skill":"mysql-health","request":"check cluster health and provide analysis"}'
      ;;
    2)
      PAYLOAD='{"skill":"mysql-topology","request":"show current replication topology"}'
      ;;
    3)
      read -p "Enter request: " request
      PAYLOAD="{\"skill\":\"mysql-demo\",\"request\":\"$request\"}"
      ;;
    *)
      echo "Invalid choice"
      return
      ;;
  esac

  echo ""
  echo "Sending webhook..."
  echo "Payload: $PAYLOAD"
  echo ""

  RESPONSE=$(curl -sf -X POST "http://localhost:3100/hooks/agent" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer clawsql-webhook-secret" \
    -d "$PAYLOAD" 2>/dev/null || echo '{"error": "Failed to send"}')

  echo "Response: $RESPONSE"
  echo ""
  echo "💡 Check http://localhost:3100 for OpenClaw response"
  echo ""
  read -p "Press Enter to continue..."
}

check_replication_lag() {
  echo ""
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║  Replication Lag Monitor                               ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo ""

  echo "Monitoring replication lag (Ctrl+C to stop)..."
  echo ""

  while true; do
    clear
    echo "Replication Lag Monitor (Ctrl+C to stop)"
    echo "════════════════════════════════════════"
    echo ""
    printf "%-20s %-10s %-10s %-15s %-10s\n" "REPLICA" "IO" "SQL" "LAG" "TIMESTAMP"
    echo "──────────────────────────────────────────────────────────"

    for replica in clawsql-replica-1 clawsql-replica-2; do
      io=$(docker exec "$replica" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}')
      sql=$(docker exec "$replica" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_SQL_Running:" | awk '{print $2}')
      lag=$(docker exec "$replica" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}')
      ts=$(date +%H:%M:%S)
      printf "%-20s %-10s %-10s %-15s %-10s\n" "$replica" "$io" "$sql" "${lag}s" "$ts"
    done

    sleep 2
  done
}

# Main loop
while true; do
  show_menu
  read -p "Enter your choice [0-7]: " choice

  case $choice in
    1) health_check ;;
    2) bash "$SCRIPT_DIR/demo-actions/demo-switchover.sh" ;;
    3) view_topology ;;
    4) test_rw_splitting ;;
    5) send_webhook ;;
    6) bash "$SCRIPT_DIR/demo-actions/demo-health-check.sh" ;;
    7) check_replication_lag ;;
    0) echo "Goodbye!"; exit 0 ;;
    *) echo "Invalid choice. Please try again." ;;
  esac
done
