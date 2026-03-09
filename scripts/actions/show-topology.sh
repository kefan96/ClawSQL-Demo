#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Show Topology ───
# Displays current MySQL replication topology from Orchestrator

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Source common library
source "$PROJECT_DIR/lib/common.sh"

ORCH_URL="http://localhost:3000"

show_topology() {
  echo ""
  echo "▶ Current Topology:"

  if ! curl -sf "$ORCH_URL/api/health" > /dev/null 2>&1; then
    echo "  (Orchestrator unreachable at $ORCH_URL)"
    echo "  Start containers with: podman compose up -d"
    echo ""
    return 1
  fi

  clusters=$(curl -sf "$ORCH_URL/api/clusters" 2>/dev/null)
  if [ -z "$clusters" ] || [ "$clusters" = "[]" ]; then
    echo "  (no clusters discovered by Orchestrator)"
    echo "  Run: bash scripts/setup.sh"
    echo ""
    return 1
  fi

  fallback_cluster=$(echo "$clusters" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0] if d else 'mysql-primary:3306')" 2>/dev/null || echo "mysql-primary:3306")
  cluster_alias=$(get_cluster_alias "$ORCH_URL")

  if [ -z "$cluster_alias" ]; then
    cluster_alias="$fallback_cluster"
  fi

  topology=$(curl -sf "$ORCH_URL/api/cluster/${cluster_alias}" 2>/dev/null)
  if [ -z "$topology" ] || [ "$topology" = "[]" ]; then
    if [ "$cluster_alias" != "$fallback_cluster" ]; then
      topology=$(curl -sf "$ORCH_URL/api/cluster/${fallback_cluster}" 2>/dev/null)
      cluster_alias="$fallback_cluster"
    fi
  fi

  if [ -n "$topology" ] && [ "$topology" != "[]" ]; then
    echo "$topology" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
primary = None
replicas = []
for item in data:
    if not item.get('ReadOnly'):
        primary = item
        break
if not primary:
    for item in data:
        if item.get('ReplicationDepth') == 0:
            primary = item
            break
if not primary and data:
    primary = data[0]
if primary:
    for item in data:
        if item != primary:
            replicas.append(item)
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
" 2>/dev/null || { echo "  (unable to parse topology)"; return 1; }
  else
    echo "  (unable to fetch topology for cluster: $cluster_alias)"
    return 1
  fi
  echo ""
}

# Main entry point
show_topology