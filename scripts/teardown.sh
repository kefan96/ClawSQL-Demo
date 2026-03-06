#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Teardown ───
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║        ClawSQL — Teardown                ║"
echo "╚══════════════════════════════════════════╝"
echo ""

echo "▶ Stopping and removing containers..."
# --remove-orphans ensures containers not in compose file are also removed
docker compose down -v --remove-orphans

echo ""
echo "▶ Removing any dangling networks..."
docker network rm clawsql-demo_clawsql 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         Teardown Complete!               ║"
echo "╚══════════════════════════════════════════╝"
