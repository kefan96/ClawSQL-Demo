#!/bin/bash
# ClawSQL Integration Test Script
# Tests the complete lifecycle against the demo cluster

set -e

CONFIG="config/local.yaml"
CLI="npx tsx src/cli/index.ts -c $CONFIG"

echo "=== ClawSQL Lifecycle Test ==="
echo ""

# 1. Show current configuration
echo "1. Configuration"
echo "---"
$CLI config show --json 2>/dev/null | head -20
echo ""

# 2. Discover topology
echo "2. Topology Discovery"
echo "---"
$CLI topology discover 2>&1 | tail -5
echo ""

# 3. Show topology
echo "3. Current Topology"
echo "---"
$CLI topology show 2>&1 | grep -A20 "=== Cluster" || true
echo ""

# 4. Switchover dry-run
echo "4. Switchover Check (Dry Run)"
echo "---"
$CLI switchover --dry-run 2>&1 | tail -10
echo ""

# 5. Health check
echo "5. Health Check"
echo "---"
$CLI health check 2>&1 | tail -10
echo ""

echo "=== Test Complete ==="