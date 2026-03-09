#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Failover Simulation ───
# Simulates a primary failure and tests automatic recovery

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Source common library
source "$PROJECT_DIR/lib/common.sh"

ORCH_URL="http://localhost:3000"
RUNTIME=$(get_runtime)

do_failover() {
  local proceed="${1:-}"

  echo "╔══════════════════════════════════════════╗"
  echo "║     Failover Simulation                  ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  cluster_alias=$(get_cluster_alias "$ORCH_URL")
  current_primary=$(get_current_primary "$cluster_alias" "$ORCH_URL")

  if [ -z "$current_primary" ]; then
    current_primary="mysql-primary"
  fi

  primary_container=$(hostname_to_container "$current_primary")

  echo "  Current primary: $current_primary (container: $primary_container)"
  echo ""

  if [ -z "$proceed" ]; then
    echo "▶ This will stop the primary MySQL instance to simulate a crash."
    echo "  Orchestrator should detect and promote a replica automatically."
    echo ""
    read -p "  Proceed? [y/N] " proceed
  fi

  if [[ ! $proceed =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return 0
  fi

  echo ""
  echo "▶ Writing test data before failure..."
  $RUNTIME exec "$primary_container" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e \
    "CREATE DATABASE IF NOT EXISTS demo; CREATE TABLE IF NOT EXISTS demo.failover_test (id INT AUTO_INCREMENT PRIMARY KEY, msg VARCHAR(100), ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP); INSERT INTO demo.failover_test (msg) VALUES ('Before failover');" 2>/dev/null \
    && echo "  ✓ Test row inserted" || echo "  ⚠ Could not insert"

  echo ""
  echo "▶ Stopping primary MySQL instance: $primary_container..."
  $RUNTIME stop "$primary_container"
  echo "  ✓ Primary stopped"

  echo ""
  echo "  Waiting 35 seconds for Orchestrator to detect and recover..."
  for i in $(seq 35 -1 0); do
    printf "\r  [%3d seconds remaining] " "$i"
    sleep 1
  done
  echo ""

  echo "▶ Checking Orchestrator recovery status..."
  problems=$(curl -sf "$ORCH_URL/api/problems" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "?")
  echo "  Active problems: $problems"

  echo ""
  echo "▶ New Topology:"
  bash "$PROJECT_DIR/scripts/actions/show-topology.sh" 2>/dev/null || true

  new_primary=$(get_current_primary "$cluster_alias" "$ORCH_URL")
  if [ -z "$new_primary" ]; then
    new_primary="unknown"
  fi

  new_container=$(hostname_to_container "$new_primary")

  echo ""
  echo "▶ Syncing ProxySQL routing with Orchestrator topology..."
  if curl -sf http://localhost:9090/servers > /dev/null 2>&1; then
    sync_result=$(curl -sf -X POST http://localhost:9090/sync-topology 2>/dev/null)
    if [ -n "$sync_result" ]; then
      echo "  ✓ ProxySQL routing synced"
      echo "$sync_result" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('actions'):
    for a in d['actions']:
        print(f\"    - {a}\")
" 2>/dev/null || true
    fi

    echo ""
    echo "  ProxySQL routing after failover:"
    show_proxysql_routing
  else
    echo "  ⚠ HTTP bridge not available - ProxySQL not updated"
  fi

  echo ""
  echo "▶ Verifying test data on new primary ($new_primary)..."
  count=$($RUNTIME exec "$new_container" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT COUNT(*) FROM demo.failover_test" 2>/dev/null || echo "0")
  echo "  $new_primary: $count rows in demo.failover_test"

  if [ "$count" -gt 0 ]; then
    echo "  ✓ Data successfully replicated before failover"
  else
    echo "  ⚠ Test data not found"
  fi

  echo ""
  echo "  Failover completed. New primary: $new_primary"
  echo "  To restore: bash scripts/actions/do-failover-rollback.sh"
  echo "FAILOVER_COMPLETE"
}

# Main entry point
do_failover "${1:-}"