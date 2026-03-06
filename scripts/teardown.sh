#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Teardown ───
# Stops containers and removes all data.

RUNTIME="podman"
command -v podman &>/dev/null || RUNTIME="docker"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║        ClawSQL — Teardown                ║"
echo "╚══════════════════════════════════════════╝"
echo ""

echo "▶ Stopping and removing containers..."
$RUNTIME compose down -v --remove-orphans

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         Teardown Complete!               ║"
echo "╚══════════════════════════════════════════╝"
