#!/bin/sh
# End-to-end switchover test

echo "=== ClawSQL Switchover Test ==="
echo ""

# Discover and show topology
echo "1. Discovering topology..."
npx tsx src/cli/index.ts topology show 2>&1 | grep -E "(Cluster|Primary|Replicas|lag|server_id)" | head -10

# Get current primary
PRIMARY=$(npx tsx src/cli/index.ts topology show 2>&1 | grep "mysql-" | head -1 | awk '{print $1}')
echo ""
echo "Current primary: $PRIMARY"

# Perform switchover
echo ""
echo "2. Performing switchover to mysql-replica-1..."
npx tsx src/cli/index.ts switchover --target mysql-replica-1 2>&1 | tail -20

# Verify new topology
echo ""
echo "3. Verifying new topology..."
npx tsx src/cli/index.ts topology show 2>&1 | grep -E "(Cluster|Primary|Replicas|lag|server_id)" | head -10

echo ""
echo "=== Test Complete ==="