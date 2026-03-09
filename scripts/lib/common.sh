#!/usr/bin/env bash
# ─── ClawSQL Common Library ───
# Shared functions for all action scripts

# Container runtime detection
get_runtime() {
  if command -v podman &>/dev/null; then
    echo "podman"
  else
    echo "docker"
  fi
}

# Get cluster alias from Orchestrator (finds writable primary)
# Usage: cluster_alias=$(get_cluster_alias [orch_url])
get_cluster_alias() {
  local orch_url="${1:-http://localhost:3000}"
  local clusters
  clusters=$(curl -sf "$orch_url/api/clusters" 2>/dev/null)
  if [ -z "$clusters" ] || [ "$clusters" = "[]" ]; then
    echo "mysql-primary:3306"
    return
  fi
  echo "$clusters" | python3 -c "
import sys, json, urllib.request
clusters = json.load(sys.stdin)
for cluster in clusters:
    try:
        with urllib.request.urlopen(f'$orch_url/api/cluster/{cluster}', timeout=2) as resp:
            data = json.loads(resp.read())
            for item in data:
                if not item.get('ReadOnly', True):
                    print(cluster)
                    sys.exit(0)
    except Exception:
        continue
if clusters:
    print(clusters[0])
else:
    print('mysql-primary:3306')
" 2>/dev/null || echo "mysql-primary:3306"
}

# Map MySQL hostname to container name
# Usage: container=$(hostname_to_container "mysql-primary")
hostname_to_container() {
  echo "$1" | sed 's/^mysql-/clawsql-/'
}

# Map container name to MySQL hostname
# Usage: hostname=$(container_to_hostname "clawsql-primary")
container_to_hostname() {
  echo "$1" | sed 's/^clawsql-/mysql-/'
}

# Get current primary hostname from Orchestrator
# Usage: primary=$(get_current_primary [cluster_alias] [orch_url])
get_current_primary() {
  local cluster_alias="${1:-mysql-primary:3306}"
  local orch_url="${2:-http://localhost:3000}"
  curl -sf "$orch_url/api/cluster/${cluster_alias}" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d:
    if not item.get('ReadOnly'):
        print(item['Key']['Hostname'])
        break
" 2>/dev/null || echo ""
}

# Get all replicas from Orchestrator
# Usage: replicas=$(get_replicas [cluster_alias] [orch_url])
get_replicas() {
  local cluster_alias="${1:-mysql-primary:3306}"
  local orch_url="${2:-http://localhost:3000}"
  curl -sf "$orch_url/api/cluster/${cluster_alias}" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
replicas = [r['Key']['Hostname'] for r in d if r.get('ReadOnly')]
print(' '.join(replicas))
" 2>/dev/null || echo ""
}

# Get current writer from ProxySQL via HTTP bridge
# Usage: writer=$(get_proxysql_writer [bridge_url])
get_proxysql_writer() {
  local bridge_url="${1:-http://localhost:9090}"
  curl -sf "$bridge_url/servers" 2>/dev/null | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
for s in data.get('servers', []):
    if s['hostgroup_id'] == 10:
        print(s['hostname'])
        break
" 2>/dev/null || echo ""
}

# Sync ProxySQL routing with Orchestrator topology
# Usage: sync_proxysql_routing [orch_url] [bridge_url]
sync_proxysql_routing() {
  local orch_url="${1:-http://localhost:3000}"
  local bridge_url="${2:-http://localhost:9090}"

  if ! curl -sf "$bridge_url/servers" > /dev/null 2>&1; then
    echo "HTTP bridge not available"
    return 1
  fi

  local cluster_alias
  cluster_alias=$(get_cluster_alias "$orch_url")

  # Get actual primary from Orchestrator
  local actual_primary
  actual_primary=$(get_current_primary "$cluster_alias" "$orch_url")

  # Get all replicas from Orchestrator
  local replicas
  replicas=$(get_replicas "$cluster_alias" "$orch_url")

  if [ -z "$actual_primary" ]; then
    echo "Could not determine primary from Orchestrator"
    return 1
  fi

  # Get current writer from ProxySQL
  local current_writer
  current_writer=$(get_proxysql_writer "$bridge_url")

  # Switch writer if needed
  if [ "$current_writer" != "$actual_primary" ] && [ -n "$current_writer" ]; then
    echo "  Switching writer: $current_writer -> $actual_primary..."
    curl -sf -X POST "$bridge_url/switch-writer" \
      -H "Content-Type: application/json" \
      -d "{\"oldHost\":\"$current_writer\",\"newHost\":\"$actual_primary\"}" 2>/dev/null || true
  fi

  # Ensure all replicas are in reader hostgroup
  for replica in $replicas; do
    curl -sf -X POST "$bridge_url/add-server" \
      -H "Content-Type: application/json" \
      -d "{\"hostgroup\":20,\"hostname\":\"$replica\",\"port\":3306}" 2>/dev/null || true
  done

  return 0
}

# Show ProxySQL routing table
# Usage: show_proxysql_routing [bridge_url]
show_proxysql_routing() {
  local bridge_url="${1:-http://localhost:9090}"
  curl -sf "$bridge_url/servers" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for s in data.get('servers', []):
    hg = 'writer' if s['hostgroup_id'] == 10 else 'reader'
    print(f\"  [{hg}] {s['hostname']}:{s['port']} ({s['status']})\")
" 2>/dev/null || echo "  Could not fetch routing"
}

# Check for multi-master condition
# Usage: count=$(check_multi_master [cluster_alias] [orch_url])
check_multi_master() {
  local cluster_alias="${1:-mysql-primary:3306}"
  local orch_url="${2:-http://localhost:3000}"
  local topology
  topology=$(curl -sf "$orch_url/api/cluster/${cluster_alias}" 2>/dev/null)
  if [ -z "$topology" ] || [ "$topology" = "[]" ]; then
    echo "0"
    return
  fi
  echo "$topology" | python3 -c "
import sys, json
d = json.load(sys.stdin)
writable = [i for i in d if not i.get('ReadOnly', True)]
print(len(writable))
" 2>/dev/null || echo "0"
}

# Wait for MySQL to be ready
# Usage: wait_mysql_ready [container] [timeout_seconds]
wait_mysql_ready() {
  local container="$1"
  local timeout="${2:-30}"
  local runtime="${RUNTIME:-$(get_runtime)}"

  for i in $(seq "$timeout" -1 0); do
    if $runtime exec "$container" mysqladmin ping -h127.0.0.1 -P3306 -uroot -proot_pass --silent 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}