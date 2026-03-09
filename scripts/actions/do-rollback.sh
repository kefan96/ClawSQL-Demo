#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Rollback to Original Primary ───
# Rolls back switchover by making mysql-primary the primary again

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Source common library
source "$PROJECT_DIR/lib/common.sh"

ORCH_URL="http://localhost:3000"
RUNTIME=$(get_runtime)

do_rollback() {
  local proceed="${1:-}"

  echo "╔══════════════════════════════════════════╗"
  echo "║     Rollback to Original Primary         ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  cluster_alias=$(get_cluster_alias "$ORCH_URL")
  current_primary=$(get_current_primary "$cluster_alias" "$ORCH_URL")

  original_primary="mysql-primary"

  if [ "$current_primary" = "$original_primary" ]; then
    echo "  $original_primary is already the primary. No rollback needed."
    return 0
  fi

  echo "  Current primary: $current_primary"
  echo "  Rollback target: $original_primary"
  echo ""

  if [ -z "$proceed" ]; then
    read -p "  Proceed with rollback? [y/N] " proceed
  fi

  if [[ ! $proceed =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return 0
  fi

  echo ""
  echo "▶ Executing rollback via Orchestrator..."

  replicas=$(curl -sf "$ORCH_URL/api/cluster/${cluster_alias}" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
replicas = [r for r in d if r.get('ReadOnly') and r['Key']['Hostname'] != '$original_primary']
print(' '.join([f\"{r['Key']['Hostname']}/{r['Key']['Port']}\" for r in replicas]))
" 2>/dev/null || echo "")
  echo "    Replicas: $replicas"

  echo "  Step 1: Rearranging replication topology..."
  for replica in $replicas; do
    replica_host=$(echo "$replica" | cut -d'/' -f1)
    replica_port=$(echo "$replica" | cut -d'/' -f2)
    echo "    Moving $replica_host below $original_primary..."
    curl -sf "$ORCH_URL/api/move-below/${replica_host}/${replica_port}/${original_primary}/3306" > /dev/null 2>&1 || true
  done

  echo "    Moving $original_primary under $current_primary..."
  curl -sf "$ORCH_URL/api/move-below/${original_primary}/3306/${current_primary}/3306" > /dev/null 2>&1 || true
  sleep 2

  echo "  Step 2: Executing graceful takeover..."
  result=$(curl -sf "$ORCH_URL/api/graceful-master-takeover/${cluster_alias}/${original_primary}/3306" 2>/dev/null)

  code=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Code',''))" 2>/dev/null || echo "")
  successor=$(echo "$result" | python3 -c "
import sys,json
d = json.load(sys.stdin)
sk = d.get('Details', {}).get('SuccessorKey', {})
print(f\"{sk.get('Hostname','?')}:{sk.get('Port','?')}\")
" 2>/dev/null || echo "")

  if [ "$code" = "OK" ]; then
    echo "  ✓ Rollback successful"
    echo "  Primary restored: $successor"

    # Ensure replicas are replicating
    echo ""
    echo "▶ Ensuring replication is running on all replicas..."
    for container in clawsql-replica-1 clawsql-replica-2; do
      io_running=$($RUNTIME exec "$container" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}' || echo "No")
      if [ "$io_running" != "Yes" ]; then
        echo "  Starting slave on $container..."
        $RUNTIME exec "$container" mysql -uroot -proot_pass -e "START SLAVE;" 2>/dev/null || true
      fi
    done

    # Update ProxySQL routing via sync-topology
    echo ""
    echo "▶ Updating ProxySQL routing..."
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
      echo "  Final ProxySQL routing:"
      show_proxysql_routing
    else
      echo "  ⚠ HTTP bridge not available - ProxySQL not updated"
    fi

    sleep 3
    bash "$PROJECT_DIR/scripts/actions/show-topology.sh" 2>/dev/null || true
    echo "ROLLBACK_SUCCESS"
  else
    echo "  ✗ Rollback failed"
    echo "  Response: $result"
    echo "ROLLBACK_FAILED"
  fi
}

# Main entry point
do_rollback "${1:-}"