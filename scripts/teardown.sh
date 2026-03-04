#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Teardown ───
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Stopping and removing ClawSQL containers..."
docker compose down -v

echo "✓ All containers and volumes removed"
