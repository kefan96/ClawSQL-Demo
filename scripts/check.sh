#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Health Check (Docker) ───
# Quick health check for all components.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

OPENCLAW_URL="http://localhost:3100"
WEBHOOK_SECRET="clawsql-webhook-secret"
ORCH_URL="http://localhost:3000"

# Container runtime
RUNTIME="podman"
if ! command -v podman &>/dev/null; then
  RUNTIME="docker"
fi

echo "╔══════════════════════════════════════════╗"
echo "║     ClawSQL — Health Check               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# OpenClaw
echo "OpenClaw:"
if curl -sf "$OPENCLAW_URL" > /dev/null 2>&1; then
  echo "  ✓ Reachable at $OPENCLAW_URL"
  resp=$(curl -sf -X POST "$OPENCLAW_URL/hooks/agent" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $WEBHOOK_SECRET" \
    -d '{"skill":"mysql-health","message":"check cluster health"}' 2>/dev/null)
  if [ -n "$resp" ]; then
    runid=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runId','?'))" 2>/dev/null || echo "?")
    echo "  ✓ Health check requested (runId: $runid)"
    echo "  → Check UI: $OPENCLAW_URL"
  fi
else
  echo "  ✗ Unreachable at $OPENCLAW_URL"
fi
echo ""

# Orchestrator
echo "Orchestrator:"
if curl -sf "$ORCH_URL/api/health" > /dev/null 2>&1; then
  echo "  ✓ Reachable"
  clusters=$(curl -sf "$ORCH_URL/api/clusters" 2>/dev/null || echo "")
  if [ -n "$clusters" ] && [ "$clusters" != "[]" ]; then
    echo "  Clusters: $clusters"
    topology=$(curl -sf "$ORCH_URL/api/cluster/alias/mysql-primary:3306" 2>/dev/null)
    if [ -n "$topology" ] && echo "$topology" | grep -q '"Key"'; then
      primary=$(echo "$topology" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Key']['Hostname'] if d and isinstance(d,list) and len(d)>0 else 'N/A')" 2>/dev/null || echo "?")
      replicas=$(echo "$topology" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d[0].get('Replicas',[])) if d and isinstance(d,list) and len(d)>0 else 0)" 2>/dev/null || echo "?")
      echo "  Topology: Primary=$primary, Replicas=$replicas"
    fi
  else
    echo "  No clusters discovered yet"
  fi
else
  echo "  ✗ Unreachable at $ORCH_URL"
fi
echo ""

# ProxySQL
echo "ProxySQL:"
if $RUNTIME exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "SELECT 1" > /dev/null 2>&1; then
  echo "  ✓ Admin reachable"
  writers=$($RUNTIME exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -N -e "SELECT COUNT(*) FROM mysql_servers WHERE hostgroup_id=10 AND status='ONLINE'" 2>/dev/null || echo "?")
  readers=$($RUNTIME exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -N -e "SELECT COUNT(*) FROM mysql_servers WHERE hostgroup_id=20 AND status='ONLINE'" 2>/dev/null || echo "?")
  echo "  Routing: HG10(writers)=$writers, HG20(readers)=$readers"
else
  echo "  ✗ Unreachable at port 6032"
fi
echo ""

# MySQL Instances
echo "MySQL Instances:"

# Primary
if $RUNTIME exec clawsql-primary mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "SELECT 1" > /dev/null 2>&1; then
  ro=$($RUNTIME exec clawsql-primary mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT @@read_only;" 2>/dev/null || echo "1")
  sid=$($RUNTIME exec clawsql-primary mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT @@server_id;" 2>/dev/null || echo "?")
  role=$([ "$ro" = "0" ] && echo "writer" || echo "reader")
  echo "  ✓ Primary (clawsql-primary): server_id=$sid role=$role"
else
  echo "  ✗ Primary (clawsql-primary): unreachable"
fi

# Replica 1
if $RUNTIME exec clawsql-replica-1 mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "SELECT 1" > /dev/null 2>&1; then
  ro=$($RUNTIME exec clawsql-replica-1 mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT @@read_only;" 2>/dev/null || echo "1")
  sid=$($RUNTIME exec clawsql-replica-1 mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT @@server_id;" 2>/dev/null || echo "?")
  role=$([ "$ro" = "0" ] && echo "writer" || echo "reader")
  echo "  ✓ Replica1 (clawsql-replica-1): server_id=$sid role=$role"
else
  echo "  ✗ Replica1 (clawsql-replica-1): unreachable"
fi

# Replica 2
if $RUNTIME exec clawsql-replica-2 mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "SELECT 1" > /dev/null 2>&1; then
  ro=$($RUNTIME exec clawsql-replica-2 mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT @@read_only;" 2>/dev/null || echo "1")
  sid=$($RUNTIME exec clawsql-replica-2 mysql -h127.0.0.1 -P3306 -uroot -proot_pass -N -e "SELECT @@server_id;" 2>/dev/null || echo "?")
  role=$([ "$ro" = "0" ] && echo "writer" || echo "reader")
  echo "  ✓ Replica2 (clawsql-replica-2): server_id=$sid role=$role"
else
  echo "  ✗ Replica2 (clawsql-replica-2): unreachable"
fi
echo ""

# Replication
echo "Replication:"
for replica_name in replica1 replica2; do
  case $replica_name in
    replica1) container="clawsql-replica-1" ;;
    replica2) container="clawsql-replica-2" ;;
  esac

  status=$($RUNTIME exec "$container" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null || echo "")
  if [ -n "$status" ]; then
    io=$(echo "$status" | grep "Slave_IO_Running:" | awk '{print $2}')
    sql=$(echo "$status" | grep "Slave_SQL_Running:" | awk '{print $2}')
    lag=$(echo "$status" | grep "Seconds_Behind_Master:" | awk '{print $2}')
    echo "  $replica_name: IO=$io SQL=$sql Lag=${lag:-?}s"
  else
    echo "  $replica_name: no status"
  fi
done
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
