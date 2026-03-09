#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Controlled Switchover ───
# Performs a controlled switchover to a selected replica

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Source common library
source "$PROJECT_DIR/lib/common.sh"

ORCH_URL="http://localhost:3000"
RUNTIME=$(get_runtime)

do_switchover() {
  local target_choice="${1:-}"

  echo "╔══════════════════════════════════════════╗"
  echo "║     Controlled Switchover                ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  # Check Orchestrator
  if ! curl -sf "$ORCH_URL/api/health" > /dev/null 2>&1; then
    echo "  ✗ Orchestrator unreachable at $ORCH_URL"
    return 1
  fi

  clusters=$(curl -sf "$ORCH_URL/api/clusters" 2>/dev/null || echo "[]")
  if [ -z "$clusters" ] || [ "$clusters" = "[]" ]; then
    echo "  ✗ No clusters discovered by Orchestrator"
    echo "  Run: bash scripts/setup.sh"
    return 1
  fi

  cluster_alias=$(get_cluster_alias "$ORCH_URL")
  if [ -z "$cluster_alias" ]; then
    cluster_alias=$(echo "$clusters" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0])" 2>/dev/null || echo "")
  fi
  if [ -z "$cluster_alias" ]; then
    echo "  ✗ Unable to determine cluster alias"
    return 1
  fi

  # CRITICAL: Check for multi-master condition BEFORE attempting switchover
  echo "  Refreshing Orchestrator discovery..."
  for host in mysql-primary mysql-replica-1 mysql-replica-2; do
    curl -sf "$ORCH_URL/api/discover/${host}/3306" > /dev/null 2>&1 || true
  done
  sleep 3

  echo "  Waiting for topology to stabilize..."
  sleep 2

  echo "  Checking cluster state..."
  writable_count=$(check_multi_master "$cluster_alias" "$ORCH_URL")
  echo "  Writable instances: $writable_count"

  if [ "$writable_count" -ne 1 ]; then
    echo "  ✗ ERROR: Cluster has $writable_count writable instances (expected 1)"
    echo "  This indicates a topology inconsistency."
    echo ""
    echo "  To fix this:"
    echo "  1. Check Orchestrator logs: docker logs clawsql-orchestrator"
    echo "  2. Verify MySQL read_only settings on each instance"
    echo "  3. You may need to manually set read_only=1 on extra writers"
    echo ""

    curl -sf "$ORCH_URL/api/cluster/${cluster_alias}" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
writable = [i for i in d if not i.get('ReadOnly', True)]
if writable:
    print('  Writable instances:')
    for w in writable:
        print(f\"    - {w['Key']['Hostname']}:{w['Key']['Port']}\")
" 2>/dev/null || true

    echo ""
    echo "  Attempting to refresh topology discovery..."
    for host in mysql-primary mysql-replica-1 mysql-replica-2; do
      curl -sf "$ORCH_URL/api/discover/${host}/3306" > /dev/null 2>&1 || true
    done
    sleep 3

    writable_count=$(check_multi_master "$cluster_alias" "$ORCH_URL")
    if [ "$writable_count" -ne 1 ]; then
      echo "  ✗ Still detecting $writable_count writable instances after refresh"
      echo "  Manual intervention required - check MySQL read_only settings"
      return 1
    fi
    echo "  ✓ Topology refreshed, now has $writable_count writable instance(s)"
  fi

  current_primary=$(get_current_primary "$cluster_alias" "$ORCH_URL")
  if [ -z "$current_primary" ]; then
    echo "  ✗ Unable to determine current primary"
    return 1
  fi

  echo "  Current primary: $current_primary"

  # Get replicas
  replicas=$(curl -sf "$ORCH_URL/api/cluster/${cluster_alias}" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
replicas = [r for r in d if r.get('ReadOnly')]
if replicas:
    for i, r in enumerate(replicas, 1):
        print(f\"{i}) {r['Key']['Hostname']}:{r['Key']['Port']}\")
" 2>/dev/null || echo "")

  echo ""
  echo "  Available replicas for promotion:"
  echo "$replicas" | sed 's/^/    /'
  echo ""

  if [ -z "$target_choice" ]; then
    read -p "  Select replica number (1-N) or 'a' for auto: " target_choice
  fi

  echo ""
  echo "▶ Requesting switchover..."

  cluster_alias_encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${cluster_alias}', safe=''))" 2>/dev/null || echo "${cluster_alias}")

  if [[ -z "$target_choice" || "$target_choice" =~ ^[Aa]$ ]]; then
    echo "  Mode: Auto-select successor"
    result=$(curl -s "$ORCH_URL/api/graceful-master-takeover-auto/${cluster_alias_encoded}" 2>&1)
  else
    target_replica=$(curl -sf "$ORCH_URL/api/cluster/${cluster_alias}" 2>/dev/null | \
      python3 -c "
import sys, json
d = json.load(sys.stdin)
replicas = [r for r in d if r.get('ReadOnly')]
idx = int('$target_choice') - 1
if 0 <= idx < len(replicas):
    r = replicas[idx]
    print(f\"{r['Key']['Hostname']}:{r['Key']['Port']}\")
" 2>/dev/null || echo "")

    if [ -n "$target_replica" ]; then
      target_host=$(echo "$target_replica" | cut -d':' -f1)
      target_port=$(echo "$target_replica" | cut -d':' -f2)
      echo "  Target: $target_replica"
      result=$(curl -s -G "$ORCH_URL/api/graceful-master-takeover-auto/${cluster_alias_encoded}" \
        --data-urlencode "targetHost=$target_host" \
        --data-urlencode "targetPort=$target_port" 2>&1)
    else
      echo "  Invalid selection, using auto..."
      result=$(curl -sf "$ORCH_URL/api/graceful-master-takeover-auto/${cluster_alias_encoded}" 2>/dev/null || echo '{"Code":"ERROR","Message":"Invalid selection"}')
    fi
  fi

  echo "  API Response: $result"

  code=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Code',''))" 2>/dev/null || echo "")
  message=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Message',''))" 2>/dev/null || echo "")

  if [ "$code" = "OK" ]; then
    successor=$(echo "$result" | python3 -c "
import sys,json
d = json.load(sys.stdin)
sk = d.get('Details', {}).get('SuccessorKey', {})
print(f\"{sk.get('Hostname','?')}:{sk.get('Port','?')}\")
" 2>/dev/null || echo "")

    echo "  ✓ Switchover successful"
    echo "  New primary: $successor"

    echo ""
    echo "▶ Verifying replication topology..."
    sleep 3

    for host in mysql-primary mysql-replica-1 mysql-replica-2; do
      curl -sf "$ORCH_URL/api/discover/${host}/3306" > /dev/null 2>&1 || true
    done
    sleep 2

    # Check for circular replication
    circular_replication=$(curl -sf "$ORCH_URL/api/cluster/${cluster_alias}" 2>/dev/null | \
      python3 -c "
import sys, json
data = json.load(sys.stdin)
co_masters = [i for i in data if i.get('IsCoMaster', False)]
if co_masters:
    print(','.join([i['Key']['Hostname'] for i in co_masters]))
" 2>/dev/null || echo "")

    if [ -n "$circular_replication" ]; then
      echo "  ⚠ WARNING: Circular replication detected on: $circular_replication"
      echo "  Attempting to fix..."

      successor_host=$(echo "$successor" | cut -d':' -f1)
      successor_container=$(hostname_to_container "$successor_host")

      echo "  Stopping slave on new primary ($successor_host)..."
      $RUNTIME exec "$successor_container" mysql -uroot -proot_pass -e "STOP SLAVE; RESET SLAVE ALL;" 2>/dev/null || true

      old_primary_host=$(echo "$current_primary" | cut -d':' -f1)
      old_primary_container=$(hostname_to_container "$old_primary_host")

      echo "  Ensuring old primary ($old_primary_host) replicates from new primary..."
      old_slave_status=$($RUNTIME exec "$old_primary_container" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Master_Host:" | awk '{print $2}' || echo "")

      if [ -z "$old_slave_status" ] || [ "$old_slave_status" != "$successor_host" ]; then
        echo "  Reconfiguring old primary to replicate from new primary..."
        $RUNTIME exec "$old_primary_container" mysql -uroot -proot_pass -e "STOP SLAVE; RESET SLAVE ALL;" 2>/dev/null || true
        curl -sf "$ORCH_URL/api/relocate/${old_primary_host}/3306/${successor_host}/3306" > /dev/null 2>&1 || true
      fi

      for host in mysql-primary mysql-replica-1 mysql-replica-2; do
        curl -sf "$ORCH_URL/api/discover/${host}/3306" > /dev/null 2>&1 || true
      done
      sleep 2

      circular_replication=$(curl -sf "$ORCH_URL/api/cluster/${cluster_alias}" 2>/dev/null | \
        python3 -c "
import sys, json
data = json.load(sys.stdin)
co_masters = [i for i in data if i.get('IsCoMaster', False)]
if co_masters:
    print(','.join([i['Key']['Hostname'] for i in co_masters]))
" 2>/dev/null || echo "")

      if [ -n "$circular_replication" ]; then
        echo "  ✗ ERROR: Could not fix circular replication automatically"
      else
        echo "  ✓ Circular replication fixed"
      fi
    else
      echo "  ✓ No circular replication detected"
    fi

    writable_count=$(check_multi_master "$cluster_alias" "$ORCH_URL")
    if [ "$writable_count" -ne 1 ]; then
      echo "  ⚠ WARNING: $writable_count writable instances (expected 1)"
    else
      echo "  ✓ Topology verified: 1 writable instance"
    fi

    # Update ProxySQL routing via sync-topology endpoint
    echo ""
    echo "▶ Updating ProxySQL routing..."

    if curl -sf http://localhost:9090/servers > /dev/null 2>&1; then
      sync_result=$(curl -sf -X POST http://localhost:9090/sync-topology 2>/dev/null)
      if [ -n "$sync_result" ]; then
        echo "  ✓ ProxySQL routing synced with Orchestrator"
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
      echo "  ⚠ HTTP bridge not available (is it running?)"
      echo "  Start with: node scripts/proxysql-http-bridge.mjs"
    fi

    # Notify OpenClaw
    OPENCLAW_URL="${OPENCLAW_URL:-http://localhost:18789}"
    WEBHOOK_SECRET="${WEBHOOK_SECRET:-clawsql-webhook-secret}"

    echo ""
    echo "▶ Notifying OpenClaw (for logging)..."

    current_primary_host=$(echo "$current_primary" | cut -d':' -f1)
    successor_host=$(echo "$successor" | cut -d':' -f1)

    webhook_response=$(curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $WEBHOOK_SECRET" \
      -d "{\"skill\":\"mysql-failover\",\"message\":\"switchover completed: old_writer=${current_primary_host} new_writer=${successor_host}\"}" 2>&1)

    if [ -n "$webhook_response" ]; then
      runid=$(echo "$webhook_response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runId','?'))" 2>/dev/null || echo "?")
      echo "  ✓ OpenClaw notified (runId: $runid)"
      echo "  → Check UI: $OPENCLAW_URL"
    else
      echo "  ⚠ OpenClaw notification failed (is OpenClaw running?)"
    fi

    echo "SWITCHOVER_SUCCESS"
    return 0
  else
    echo "  ✗ Switchover failed"
    echo "  Message: $message"
    echo "SWITCHOVER_FAILED"
    return 1
  fi
}

# Main entry point
do_switchover "${1:-}"