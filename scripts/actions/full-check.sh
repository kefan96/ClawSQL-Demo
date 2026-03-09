#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Full Component Check ───
# Runs the comprehensive check.sh script

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

bash "$SCRIPT_DIR/../check.sh"
