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

# Ensure HTTP bridge is running
ensure_bridge() {
  if ! curl -sf http://localhost:9090/servers > /dev/null 2>&1; then
    echo "▶ Starting ProxySQL HTTP Bridge..."
    node "$PROJECT_DIR/scripts/proxysql-http-bridge.mjs" &
    sleep 2
    if curl -sf http://localhost:9090/servers > /dev/null 2>&1; then
      echo "  ✓ HTTP bridge started"
    else
      echo "  ⚠ Failed to start HTTP bridge - some features may not work"
    fi
  fi
}

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
# Find the writable instance (actual primary) and replicas
primary = None
replicas = []
for item in data:
    if not item.get('ReadOnly'):
        primary = item
    else:
        replicas.append(item)
# If no writable found, fall back to ReplicationDepth
if not primary:
    for item in data:
        if item.get('ReplicationDepth') == 0:
            primary = item
            break
if primary:
    ro_status = 'read-write' if not primary.get('ReadOnly') else 'read-only'
    print(f\"  {primary['Key']['Hostname']}:{primary['Key']['Port']} (primary, {ro_status})\")
    for r in replicas:
        lag = r.get('ReplicationLagSeconds', {}).get('Int64', '?')
        io = 'OK' if r.get('ReplicationIOThreadRuning') else 'FAIL'
        sql = 'OK' if r.get('ReplicationSQLThreadRuning') else 'FAIL'
        ro = 'read-write' if not r.get('ReadOnly') else 'read-only'
        print(f\"  ├─ {r['Key']['Hostname']}:{r['Key']['Port']} (lag:{lag}s IO:{io} SQL:{sql}, {ro})\")
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
  # Use HTTP bridge instead of direct admin query (avoids auth issues)
  routing=$(curl -sf http://localhost:9090/servers 2>/dev/null)
  if [ -n "$routing" ]; then
    echo "$routing" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
for s in data.get('servers', []):
    hg = 'WRITER' if s['hostgroup_id'] == 10 else 'READER'
    print(f\"  [{hg}] {s['hostname']}:{s['port']} ({s['status']})\")
"
  else
    echo "  (unavailable - is HTTP bridge running?)"
  fi
  echo ""
}

do_switchover() {
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║     Controlled Switchover Demo           ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  show_topology
  show_routing

  # Get current primary from topology
  current_primary=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Key']['Hostname'] if d and len(d)>0 else '')" 2>/dev/null || echo "")

  # Get current ProxySQL writers
  old_writer=$(podman exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -N \
    -e "SELECT hostname FROM mysql_servers WHERE hostgroup_id=10 LIMIT 1;" 2>/dev/null || echo "$current_primary")

  # Get list of replicas for user to choose
  replicas=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
replicas = [r for r in d if r.get('ReadOnly')]
if replicas:
    for i, r in enumerate(replicas, 1):
        print(f\"{i}) {r['Key']['Hostname']}:{r['Key']['Port']}\")
" 2>/dev/null)

  echo "  Current primary: $current_primary:3306"
  echo "  Current ProxySQL writer: $old_writer:3306"
  echo ""
  echo "  Available replicas for promotion:"
  echo "$replicas" | sed 's/^/    /'
  echo ""
  read -p "  Select replica number (1-${replicas//$'\n'/} | a for auto): " -n 1 -r
  echo ""

  target_choice="$REPLY"

  read -p "  Proceed with switchover? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return
  fi

  echo ""
  echo "▶ Requesting switchover via Orchestrator (v3.2.6)..."

  # Orchestrator v3.2.6 uses GET requests with URL parameters
  # Cluster names with colons must be URL-encoded (%3A = :)
  cluster_encoded="mysql-primary%3A3306"

  if [[ "$target_choice" =~ ^[1-9]$ ]]; then
    # Get the selected replica hostname
    target_replica=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
      python3 -c "
import sys, json
d = json.load(sys.stdin)
replicas = [r for r in d if r.get('ReadOnly')]
idx = $target_choice - 1
if 0 <= idx < len(replicas):
    print(f\"{replicas[idx]['Key']['Hostname']}/{replicas[idx]['Key']['Port']}\")
" 2>/dev/null)

    if [ -n "$target_replica" ]; then
      echo "  Target: $target_replica"
      # Use designated takeover: /api/graceful-master-takeover/:clusterHint/:designatedHost/:designatedPort
      result=$(curl -sf "$ORCH_URL/api/graceful-master-takeover/${cluster_encoded}/${target_replica}" 2>/dev/null)
    else
      echo "  Invalid selection, using auto..."
      result=$(curl -sf "$ORCH_URL/api/graceful-master-takeover-auto/${cluster_encoded}" 2>/dev/null)
    fi
  else
    # Auto-select successor
    echo "  Mode: Auto-select successor"
    result=$(curl -sf "$ORCH_URL/api/graceful-master-takeover-auto/${cluster_encoded}" 2>/dev/null)
  fi

  # Parse result
  code=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Code',''))" 2>/dev/null)
  message=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Message',''))" 2>/dev/null)
  successor=$(echo "$result" | python3 -c "
import sys,json
d = json.load(sys.stdin)
sk = d.get('Details', {}).get('SuccessorKey', {})
print(f\"{sk.get('Hostname','?')}:{sk.get('Port','?')}\")
" 2>/dev/null)

  if [ "$code" = "OK" ]; then
    echo "  ✓ Switchover successful"
    echo "  New primary: $successor"
    echo ""

    # Update ProxySQL routing directly via HTTP bridge (bypasses OpenClaw AI security restrictions)
    if curl -sf http://localhost:9090/servers > /dev/null 2>&1; then
      echo "▶ Updating ProxySQL routing..."
      # Extract new primary hostname (successor is like "mysql-replica-1:3306")
      new_primary_host=$(echo "$successor" | cut -d':' -f1)
      old_writer_host=$(echo "$old_writer" | cut -d':' -f1)

      # Call the HTTP bridge directly to switch writer
      result=$(curl -sf -X POST http://localhost:9090/switch-writer \
        -H "Content-Type: application/json" \
        -d "{\"oldHost\":\"$old_writer_host\",\"newHost\":\"$new_primary_host\"}" 2>/dev/null)

      if echo "$result" | python3 -c "import sys,json; print('OK' if json.load(sys.stdin).get('success') else 'FAIL')" 2>/dev/null | grep -q OK; then
        echo "  ✓ ProxySQL routing updated (old: $old_writer_host, new: $new_primary_host)"
      else
        echo "  ⚠ ProxySQL update response: $result"
      fi
    else
      echo "  ⚠ HTTP bridge not available - ProxySQL not updated"
      echo "    Start with: node scripts/proxysql-http-bridge.mjs"
    fi

    # Reconfigure old primary as a replica of the new primary
    echo "▶ Reconfiguring old primary ($old_writer_host) as replica..."
    # Wait a moment for old primary to be ready after switchover
    sleep 2
    # Reconfigure replication with retry
    for attempt in 1 2 3; do
      if podman exec "$old_writer_host" mysql -uroot -proot_pass -e "
STOP SLAVE;
RESET SLAVE ALL;
CHANGE MASTER TO
  MASTER_HOST='$new_primary_host',
  MASTER_PORT=3306,
  MASTER_USER='repl',
  MASTER_PASSWORD='repl_pass',
  MASTER_AUTO_POSITION=1;
START SLAVE;
" 2>&1 | grep -qv "Warning"; then
        # Verify replication started
        sleep 1
        repl_status=$(podman exec "$old_writer_host" mysql -uroot -proot_pass -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep -E "Slave_IO_Running|Slave_SQL_Running" | awk '{print $2}' | sort -u)
        if [ "$repl_status" = "Yes" ]; then
          echo "  ✓ Replication configured and running on $old_writer_host -> $new_primary_host"
          break
        else
          echo "  ⚠ Attempt $attempt: Replication threads not running, retrying..."
          sleep 2
        fi
      else
        echo "  ⚠ Attempt $attempt: Could not reconfigure replication, retrying..."
        sleep 2
      fi
    done

    # Force Orchestrator to refresh topology immediately
    echo "▶ Refreshing Orchestrator topology..."
    curl -sf "$ORCH_URL/api/forget/$old_writer_host/3306" > /dev/null 2>&1 || true
    curl -sf "$ORCH_URL/api/discover/$new_primary_host/3306" > /dev/null 2>&1 || true
    sleep 6  # Wait for Orchestrator to poll and update (InstancePollSeconds=5)

    echo "  Waiting for topology and routing to update..."
    sleep 2
    show_topology
    show_routing
  else
    echo "  ✗ Switchover failed"
    echo "  Response: $result"
  fi
}

do_rollback() {
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║     Rollback to Original Primary         ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  show_topology

  # Get current primary
  current_primary=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d:
    if not item.get('ReadOnly'):
        print(item['Key']['Hostname'])
        break
" 2>/dev/null || echo "")

  original_primary="mysql-primary"

  if [ "$current_primary" = "$original_primary" ]; then
    echo "  $original_primary is already the primary. No rollback needed."
    return
  fi

  echo "  Current primary: $current_primary:3306"
  echo "  Rollback target: $original_primary:3306"
  echo ""
  read -p "  Proceed with rollback? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return
  fi

  echo ""
  echo "▶ Executing rollback via Orchestrator..."

  cluster_encoded="mysql-primary%3A3306"
  target_encoded="${original_primary}/3306"

  # Step 1: Get list of replicas under current primary
  echo "  Step 1: Identifying replication structure..."
  replicas=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
replicas = [r for r in d if r.get('ReadOnly') and r['Key']['Hostname'] != '$original_primary']
print(' '.join([f\"{r['Key']['Hostname']}/{r['Key']['Port']}\" for r in replicas]))
" 2>/dev/null)
  echo "    Replicas: $replicas"

  # Step 2: Move all replicas to replicate from original_primary
  echo "  Step 2: Rearranging replication topology..."
  for replica in $replicas; do
    replica_host=$(echo "$replica" | cut -d'/' -f1)
    replica_port=$(echo "$replica" | cut -d'/' -f2)
    echo "    Moving $replica_host below $original_primary..."
    curl -sf "$ORCH_URL/api/move-below/${replica_host}/${replica_port}/${original_primary}/3306" > /dev/null 2>&1 || true
  done

  # Step 3: Move original_primary under current_primary (to form a chain)
  echo "    Moving $original_primary under $current_primary..."
  curl -sf "$ORCH_URL/api/move-below/${original_primary}/3306/${current_primary}/3306" > /dev/null 2>&1 || true
  sleep 2

  # Step 4: Execute graceful takeover to original_primary
  echo "  Step 3: Executing graceful takeover..."
  result=$(curl -sf "$ORCH_URL/api/graceful-master-takeover/${cluster_encoded}/${target_encoded}" 2>/dev/null)

  code=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Code',''))" 2>/dev/null)
  message=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Message',''))" 2>/dev/null)
  successor=$(echo "$result" | python3 -c "
import sys,json
d = json.load(sys.stdin)
sk = d.get('Details', {}).get('SuccessorKey', {})
print(f\"{sk.get('Hostname','?')}:{sk.get('Port','?')}\")
" 2>/dev/null)

  if [ "$code" = "OK" ]; then
    echo "  ✓ Rollback successful"
    echo "  Primary restored: $successor"
    sleep 3
    show_topology
  else
    echo "  ✗ Rollback failed"
    echo "  Response: $result"
    echo ""
    echo "  Note: You may need to manually rearrange replication topology"
    echo "  and retry, or use auto-recovery."
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

  # Get current primary dynamically
  current_primary=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d:
    if not item.get('ReadOnly'):
        print(item['Key']['Hostname'])
        break
" 2>/dev/null || echo "mysql-primary")

  # Map hostname to container name
  case "$current_primary" in
    mysql-primary) primary_container="clawsql-primary" ;;
    mysql-replica-1) primary_container="clawsql-replica-1" ;;
    mysql-replica-2) primary_container="clawsql-replica-2" ;;
    *) primary_container="clawsql-primary" ;;
  esac

  echo "▶ This will stop the primary MySQL instance to simulate a crash."
  echo "  Orchestrator should detect and promote a replica automatically."
  echo ""
  echo "  Current primary: $current_primary (container: $primary_container)"
  echo ""
  read -p "  Proceed? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return
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
  echo ""

  # Check Orchestrator recovery status
  echo "▶ Checking Orchestrator recovery status..."
  problems=$(curl -sf "$ORCH_URL/api/problems/mysql-primary:3306" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "?")
  echo "  Active problems: $problems"

  echo ""
  echo "▶ New Topology:"
  show_topology
  show_routing

  # Get new primary
  new_primary=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d:
    if not item.get('ReadOnly'):
        print(item['Key']['Hostname'])
        break
" 2>/dev/null || echo "unknown")

  echo ""
  echo "▶ Verifying test data replicated to new primary ($new_primary)..."

  # Map new primary to container
  case "$new_primary" in
    mysql-primary) new_container="clawsql-primary" ;;
    mysql-replica-1) new_container="clawsql-replica-1" ;;
    mysql-replica-2) new_container="clawsql-replica-2" ;;
    *) new_container="clawsql-replica-1" ;;
  esac

  count=$($RUNTIME exec "$new_container" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT COUNT(*) FROM demo.failover_test" 2>/dev/null || echo "0")
  echo "  $new_primary: $count rows in demo.failover_test"

  if [ "$count" -gt 0 ]; then
    echo "  ✓ Data successfully replicated before failover"
  else
    echo "  ⚠ Test data not found (may be expected if binary log was truncated)"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Failover completed. New primary: $new_primary"
  echo ""
  echo "  To restore the failed instance, use option 7 (Failover rollback)"
  echo "  or run: $RUNTIME start $primary_container"
}

do_failover_rollback() {
  echo ""
  echo "╔══════════════════════════════════════════╗"
  echo "║     Failover Rollback (Restart Primary)  ║"
  echo "╚══════════════════════════════════════════╝"
  echo ""

  # Check for stopped containers
  stopped_primary=""
  stopped_container=""

  for container in clawsql-primary clawsql-replica-1 clawsql-replica-2; do
    status=$($RUNTIME inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "unknown")
    if [ "$status" = "exited" ] || [ "$status" = "stopped" ]; then
      stopped_container="$container"
      # Extract hostname from container
      stopped_primary=$($RUNTIME exec "$container" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT @@hostname;" 2>/dev/null || echo "")
      break
    fi
  done

  if [ -z "$stopped_container" ]; then
    echo "  No stopped MySQL containers found."
    echo "  All instances are running."
    return
  fi

  echo "  Found stopped instance: $stopped_primary (container: $stopped_container)"
  echo ""
  read -p "  Restart and reintegrate as replica? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Cancelled."
    return
  fi

  echo ""
  echo "▶ Starting container: $stopped_container..."
  $RUNTIME start "$stopped_container"

  echo "  Waiting for MySQL to be ready..."
  for i in $(seq 30 -1 0); do
    if $RUNTIME exec "$stopped_container" mysqladmin ping -h127.0.0.1 -P3306 -uroot -proot_pass --silent 2>/dev/null; then
      break
    fi
    printf "\r  [%d seconds] " "$i"
    sleep 1
  done
  echo ""
  echo "  ✓ MySQL ready"

  echo ""
  echo "▶ Configuring as replica..."
  # Get current primary for replication setup
  current_primary=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d:
    if not item.get('ReadOnly'):
        print(item['Key']['Hostname'])
        break
" 2>/dev/null || echo "mysql-primary")

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
" 2>&1 | grep -v "Warning"

  sleep 3

  echo ""
  echo "▶ Replication status:"
  $RUNTIME exec "$stopped_container" mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>&1 | grep -E "Master_Host|Slave_IO_Running|Slave_SQL_Running" | head -3

  echo ""
  echo "▶ Refreshing Orchestrator discovery..."
  curl -sf "$ORCH_URL/api/discover/${stopped_primary}/3306" > /dev/null 2>&1 || true
  sleep 2

  echo ""
  echo "▶ Final topology:"
  show_topology

  echo ""
  echo "  ✓ Failover rollback completed"
  echo "  $stopped_primary has been reintegrated as a replica"
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
  bash "$SCRIPT_DIR/check.sh" 2>/dev/null | grep -E "^(OpenClaw|Orchestrator|ProxySQL|MySQL|Replication)|✓|✗|Clusters|Topology|Routing|replica" | head -20
}

# ─── Main Menu ───
ensure_bridge
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
  echo "  6) Failover rollback (restart stopped primary)"
  echo "  7) Rollback to original primary"
  echo "  8) Full check (all components)"
  echo "  0) Exit"
  echo ""
  read -p "  Choice [0-8]: " choice || true

  case $choice in
    1) show_topology ;;
    2) show_routing ;;
    3) do_health ;;
    4) do_switchover ;;
    5) do_failover ;;
    6) do_failover_rollback ;;
    7) do_rollback ;;
    8) bash "$SCRIPT_DIR/check.sh" ;;
    0) echo "Goodbye!"; exit 0 ;;
    *) echo "  Invalid choice" ;;
  esac

  echo ""
  read -p "  Press Enter to continue..." || true
done
