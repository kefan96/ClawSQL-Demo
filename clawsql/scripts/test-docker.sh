#!/bin/sh
# Test ClawSQL lifecycle inside Docker network

# Install dependencies
npm install --silent 2>/dev/null

echo "=== 1. Topology Discovery ==="
npx tsx src/cli/index.ts topology discover 2>&1 | tail -3

echo ""
echo "=== 2. Topology Show ==="
npx tsx src/cli/index.ts topology show 2>&1 | grep -A20 "=== Cluster"

echo ""
echo "=== 3. Switchover Check ==="
npx tsx src/cli/index.ts switchover --dry-run 2>&1 | tail -10

echo ""
echo "=== 4. Health Check ==="
npx tsx src/cli/index.ts health check 2>&1 | tail -10

echo ""
echo "=== Test Complete ==="