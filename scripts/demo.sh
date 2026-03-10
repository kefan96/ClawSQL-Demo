#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Interactive Demo (Docker) ───
# Menu-driven demo for switchover, failover, and topology checks.
# This script is a thin wrapper around modular action scripts.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ACTIONS_DIR="$SCRIPT_DIR/actions"
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
    nohup node "$PROJECT_DIR/scripts/proxysql-http-bridge.mjs" > /tmp/proxysql-bridge.log 2>&1 &
    local bridge_pid=$!
    disown $bridge_pid 2>/dev/null || true
    sleep 3
    if curl -sf http://localhost:9090/servers > /dev/null 2>&1; then
      echo "  ✓ HTTP bridge started (PID: $bridge_pid)"
    else
      echo "  ⚠ Failed to start HTTP bridge - some features may not work"
      echo "  Check logs: cat /tmp/proxysql-bridge.log"
    fi
  fi
}

# ─── Main Menu ───
ensure_bridge

while true; do
  echo ""
  echo "╔════════════════════════════════════════════════════╗"
  echo "║        ClawSQL Interactive Demo                    ║"
  echo "╚════════════════════════════════════════════════════╝"
  echo ""
  echo "  TOPOLOGY & ROUTING"
  echo "  1) Show topology          - MySQL replication topology"
  echo "  2) Show routing           - ProxySQL server routing"
  echo ""
  echo "  FAILOVER & SWITCHOVER"
  echo "  3) Controlled switchover  - Graceful primary handover"
  echo "  4) Failover simulation    - Crash and auto-recovery"
  echo "  5) Failover rollback      - Restart stopped primary"
  echo "  6) Rollback to original   - Restore mysql-primary"
  echo ""
  echo "  HEALTH & DIAGNOSTICS"
  echo "  7) Health check           - OpenClaw health analysis"
  echo "  8) Full check             - All components status"
  echo ""
  echo "  0) Exit"
  echo ""
  read -p "  Choice [0-8]: " choice || true

  case $choice in
    1)
      # Show topology
      bash "$ACTIONS_DIR/show-topology.sh"
      ;;
    2)
      # Show routing
      bash "$ACTIONS_DIR/show-routing.sh"
      ;;
    3)
      # Controlled switchover
      bash "$ACTIONS_DIR/do-switchover.sh"
      result=$?
      if [ $result -eq 0 ]; then
        echo ""
        echo "  ✓ Switchover complete - ProxySQL routing updated"
      fi
      ;;
    4)
      # Failover simulation
      bash "$ACTIONS_DIR/do-failover.sh"
      ;;
    5)
      # Failover rollback
      bash "$ACTIONS_DIR/do-failover-rollback.sh"
      ;;
    6)
      # Rollback to original primary
      bash "$ACTIONS_DIR/do-rollback.sh"
      ;;
    7)
      # Health check
      bash "$ACTIONS_DIR/do-health.sh"
      ;;
    8)
      # Full check
      bash "$ACTIONS_DIR/full-check.sh"
      ;;
    0)
      echo "Goodbye!"
      exit 0
      ;;
    *)
      echo "  Invalid choice"
      ;;
  esac

  echo ""
  read -p "  Press Enter to continue..." || true
done
