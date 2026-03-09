#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Failover Rollback ───
# Restarts a stopped primary and reintegrates it as a replica

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Source common library
source "$PROJECT_DIR/lib/common.sh"

ORCH_URL="http://localhost:3000"
RUNTIME=$(get_runtime)

do_failover_rollback() {
  local proceed="${1:-}"

  echo "╔══════════════════════════════════════════╗"
  echo "║     Failover Rollback                    ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  stopped_container=""
  stopped_primary=""

  for container in clawsql-primary clawsql-replica-1 clawsql-replica-2; do
    status=$($RUNTIME inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")
    if [ "$status" = "exited" ] || [ "$status" = "stopped" ]; then
      stopped_container="$container"
      stopped_primary=$(container_to_hostname "$container")
      break
    fi
  done

  if [ -z "$stopped_container" ]; then
    echo "  No stopped MySQL containers found."
    return 0
  fi

  echo "  Found stopped instance: $stopped_primary (container: $stopped_container)"
  echo ""

  if [ -z "$proceed" ]; then
    read -p "  Restart and reintegrate as replica? [y/N] " proceed
  fi

  if [[ ! $proceed =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return 0
  fi

  echo ""
  echo "▶ Starting container: $stopped_container..."
  $RUNTIME start "$stopped_container"

  echo "  Waiting for MySQL to be ready..."
  if wait_mysql_ready "$stopped_container" 30; then
    echo "  ✓ MySQL ready"
  else
    echo "  ✗ MySQL did not become ready in time"
    return 1
  fi

  echo ""
  echo "▶ Configuring as replica..."
  cluster_alias=$(get_cluster_alias "$ORCH_URL")
  current_primary=$(get_current_primary "$cluster_alias" "$ORCH_URL")

  if [ -z "$current_primary" ]; then
    current_primary="mysql-primary"
  fi

  $RUNTIME exec "$stopped_container" mysql -uroot -proot_pass -e "
STOP SLAVE;
RESET SLAVE ALL;
CHANGE MASTER TO
  MASTER_HOST='$current_primary',
  MASTER_PORT=3306,
  MASTER_USER='repl',
  MASTER_PASSWORD='repl_pass',
  MASTER_AUTO_POSITION=1;
START SLAVE;
" 2>&1 | grep -v "Warning" || true

  sleep 3

  echo ""
  echo "▶ Replication status:"
  $RUNTIME exec "$stopped_container" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>&1 | grep -E "Master_Host|Slave_IO_Running|Slave_SQL_Running" | head -3 || echo "  (unable to get replication status)"

  echo ""
  echo "▶ Refreshing Orchestrator discovery..."
  curl -sf "$ORCH_URL/api/discover/${stopped_primary}/3306" > /dev/null 2>&1 || true
  sleep 2

  # Sync ProxySQL routing with actual Orchestrator topology
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
    echo "  Final ProxySQL routing:"
    show_proxysql_routing
  else
    echo "  ⚠ HTTP bridge not available - ProxySQL not updated"
  fi

  echo ""
  echo "▶ Final topology:"
  bash "$PROJECT_DIR/scripts/actions/show-topology.sh" 2>/dev/null || true

  echo ""
  echo "  ✓ Failover rollback completed"
  echo "FAILOVER_ROLLBACK_COMPLETE"
}

# Main entry point
do_failover_rollback "${1:-}"