#!/bin/bash
# ClawSQL Demo - Test topology discovery and switchover

set -e

echo "=== ClawSQL Demo ==="
echo ""

# Check if cluster is running
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "clawsql-primary"; then
    echo "Error: Demo cluster not running."
    echo "Start it with: cd /root/ClawSQL-Demo && ./scripts/setup.sh"
    exit 1
fi

# Build if needed
if [ ! -f "dist/cli/index.js" ]; then
    echo "Building ClawSQL..."
    npm run build 2>/dev/null
fi

echo "1. Topology Discovery"
echo "-------------------"
docker run --rm --network clawsql-demo_clawsql \
    -v $(pwd):/app -w /app node:22-alpine \
    sh -c "npm install --silent 2>/dev/null && node dist/cli/index.js topology show" 2>&1 | \
    grep -v "DeprecationWarning" | grep -E "(Cluster|Primary|Replicas|lag|server_id|===)" | head -15

echo ""
echo "2. Switchover Check"
echo "-------------------"
docker run --rm --network clawsql-demo_clawsql \
    -v $(pwd):/app -w /app node:22-alpine \
    sh -c "npm install --silent 2>/dev/null && node dist/cli/index.js switchover --dry-run" 2>&1 | \
    grep -v "DeprecationWarning" | tail -8

echo ""
echo "=== Demo Complete ==="