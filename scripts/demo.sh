#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Interactive Demo (Docker) ───
# Menu-driven demo for switchover, failover, and topology checks.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

OPENCLAW_URL="http://localhost:18789"
WEBHOOK_SECRET="clawsql-webhook-secret"
ORCH_URL="http://localhost:3000"

# Container runtime
RUNTIME="podman"
if ! command -v podman &>/dev/null; then
  RUNTIME="docker"
fi

send_webhook() {
  local skill="$1"
  local msg="$2"
  curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $WEBHOOK_SECRET" \
    -d "{\"skill\":\"$skill\",\"message\":\"$msg\"}" 2>/dev/null || echo '{"error":"failed"}'
}

show_topology() {
  echo ""
  echo "▶ Current Topology:"
  topology=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null)
  if [ -n "$topology" ]; then
    echo "$topology" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
primary = None
replicas = []
for item in data:
    if item.get('ReplicationDepth') == 0:
        primary = item
    elif item.get('ReplicationDepth') == 1:
        replicas.append(item)
if primary:
    print(f\"  {primary['Key']['Hostname']}:{primary['Key']['Port']} (primary)\")
    for r in replicas:
        lag = r.get('ReplicationLagSeconds', {}).get('Int64', '?')
        io = 'OK' if r.get('ReplicationIOThreadRuning') else 'FAIL'
        sql = 'OK' if r.get('ReplicationSQLThreadRuning') else 'FAIL'
        print(f\"  ├─ {r['Key']['Hostname']}:{r['Key']['Port']} (lag:{lag}s IO:{io} SQL:{sql})\")
else:
    print('  (unable to parse topology)')
"
  else
    echo "  (unable to fetch topology)"
  fi
  echo ""
}

show_routing() {
  echo ""
  echo "▶ ProxySQL Routing:"
  $RUNTIME exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
    -e "SELECT hostgroup_id AS HG, hostname, port, status FROM mysql_servers ORDER BY hostgroup_id, hostname;" 2>/dev/null || echo "  (unavailable)"
  echo ""
}

do_switchover() {
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║     Controlled Switchover Demo           ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  show_topology

  current_primary=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Key']['Hostname'] if d and len(d)>0 else '')" 2>/dev/null || echo "")

  target_host="mysql-replica-1"
  target_port=3306

  echo "  Current primary: $current_primary:3306"
  echo "  Target for promotion: $target_host:$target_port"
  echo ""
  read -p "  Proceed with switchover? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return
  fi

  echo ""
  echo "▶ Requesting switchover via Orchestrator..."
  result=$(curl -sf -X POST "$ORCH_URL/api/graceful-master-takeover-auto/mysql-primary:3306" \
    -H "Content-Type: application/json" \
    -d "{\"targetHost\":\"$target_host\",\"targetPort\":$target_port}" 2>/dev/null)

  if echo "$result" | grep -q '"Code":"OK"' 2>/dev/null || echo "$result" | grep -q '"Code": "OK"' 2>/dev/null; then
    echo "  ✓ Switchover initiated"
    echo "  Waiting for topology to update..."
    sleep 5
    show_topology
    show_routing
  else
    echo "  Result: $result"
  fi
  echo ""

  if curl -sf "$OPENCLAW_URL" > /dev/null 2>&1; then
    echo "▶ Notifying OpenClaw of switchover..."
    send_webhook "mysql-demo" "switchover completed" > /dev/null
    echo "  ✓ OpenClaw notified"
  fi
}

do_failover() {
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║     Failover Simulation Demo             ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  show_topology
  show_routing

  echo "▶ This will stop the primary MySQL instance to simulate a crash."
  echo "  Orchestrator should detect and promote a replica automatically."
  echo ""
  read -p "  Proceed? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return
  fi

  echo ""
  echo "▶ Writing test data before failure..."
  $RUNTIME exec clawsql-primary mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e \
    "CREATE DATABASE IF NOT EXISTS demo; CREATE TABLE IF NOT EXISTS demo.failover_test (id INT AUTO_INCREMENT PRIMARY KEY, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP); INSERT INTO demo.failover_test VALUES ();" 2>/dev/null \
    && echo "  ✓ Test row inserted" || echo "  ⚠ Could not insert"

  echo ""
  echo "▶ Stopping primary MySQL instance..."
  $RUNTIME stop clawsql-primary
  echo "  ✓ Primary stopped"

  echo ""
  echo "  Waiting 30 seconds for Orchestrator to detect and recover..."
  for i in $(seq 30 -1 0); do
    printf "\r  [%3d seconds remaining] " "$i"
    sleep 1
  done
  echo ""
  echo ""

  echo "▶ New Topology:"
  show_topology
  show_routing

  echo "▶ Verifying test data replicated..."
  for replica_name in replica1 replica2; do
    case $replica_name in
      replica1) container="clawsql-replica-1" ;;
      replica2) container="clawsql-replica-2" ;;
    esac
    count=$($RUNTIME exec "$container" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT COUNT(*) FROM demo.failover_test" 2>/dev/null || echo "0")
    echo "  $replica_name: $count rows in demo.failover_test"
  done

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "To restore: $RUNTIME start clawsql-primary"
  echo "  (it will rejoin as a replica)"
}

do_health() {
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║     Health Check via OpenClaw            ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  if ! curl -sf "$OPENCLAW_URL" > /dev/null 2>&1; then
    echo "  ⚠ OpenClaw not available at $OPENCLAW_URL"
    echo "  Running local health check instead..."
    bash "$SCRIPT_DIR/check.sh"
    return
  fi

  echo "▶ Sending health check request to OpenClaw..."
  resp=$(send_webhook "mysql-health" "check cluster health and analyze replication")

  if [ -n "$resp" ]; then
    runid=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runId','?'))" 2>/dev/null || echo "?")
    echo "  ✓ Request sent (runId: $runid)"
    echo "  → Check results at: $OPENCLAW_URL"
  else
    echo "  ⚠ No response from OpenClaw"
  fi
  echo ""

  echo "▶ Direct health summary:"
  bash "$SCRIPT_DIR/check.sh" 2>/dev/null | grep -E "^(OpenClaw|Orchestrator|ProxySQL|MySQL|Replication)" | head -10
}

# ─── Main Menu ───
while true; do
  echo ""
  echo "╔════════════════════════════════════════════════════╗"
  echo "║        ClawSQL Interactive Demo                    ║"
  echo "╚════════════════════════════════════════════════════╝"
  echo ""
  echo "  1) Show topology"
  echo "  2) Show ProxySQL routing"
  echo "  3) Health check"
  echo "  4) Controlled switchover"
  echo "  5) Failover simulation"
  echo "  6) Full check (all components)"
  echo "  0) Exit"
  echo ""
  read -p "  Choice [0-6]: " choice || true

  case $choice in
    1) show_topology ;;
    2) show_routing ;;
    3) do_health ;;
    4) do_switchover ;;
    5) do_failover ;;
    6) bash "$SCRIPT_DIR/check.sh" ;;
    0) echo "Goodbye!"; exit 0 ;;
    *) echo "  Invalid choice" ;;
  esac

  echo ""
  read -p "  Press Enter to continue..." || true
done
