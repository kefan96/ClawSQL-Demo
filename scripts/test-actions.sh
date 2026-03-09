#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Action Test Runner ───
# Runs all actions non-interactively for testing purposes

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ACTIONS_DIR="$SCRIPT_DIR/actions"
cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║     ClawSQL - Action Test Runner         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

run_action() {
  local action="$1"
  local args="${2:-}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ Running: $action ${args:-(no args)}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if bash "$ACTIONS_DIR/$action.sh" $args; then
    echo "✓ $action completed successfully"
  else
    echo "✗ $action failed (exit code: $?)"
  fi
  echo ""
}

# Run tests
run_action "show-topology"
run_action "show-routing"

# Interactive tests (require user confirmation)
if [[ "${1:-}" == "--interactive" ]]; then
  run_action "do-switchover" "a"  # auto-select
  # Note: failover and rollback are destructive, skipped in automated test
  echo "Skipping destructive tests (failover, rollback) in automated mode"
else
  echo "Run with --interactive to test switchover"
  echo "Skipping destructive tests (failover, rollback) in non-interactive mode"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Test runner completed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
