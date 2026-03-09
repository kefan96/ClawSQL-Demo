#!/bin/sh
# Full lifecycle test for ClawSQL

echo "=== ClawSQL Lifecycle Test ==="
echo ""

# 1. Discover topology
echo "1. Discovering topology..."
npx tsx src/cli/index.ts topology discover 2>&1 | tail -3

# 2. Show topology
echo ""
echo "2. Current topology:"
npx tsx src/cli/index.ts topology show 2>&1 | grep -A15 "=== Cluster"

# 3. Check switchover readiness
echo ""
echo "3. Switchover readiness check:"
npx tsx src/cli/index.ts switchover --dry-run 2>&1 | tail -10

# 4. Perform switchover to replica-1
echo ""
echo "4. Performing switchover to mysql-replica-1..."
npx tsx src/cli/index.ts switchover --target mysql-replica-1 2>&1 | tail -15

# 5. Verify new topology
echo ""
echo "5. New topology after switchover:"
npx tsx src/cli/index.ts topology show 2>&1 | grep -A15 "=== Cluster"

# 6. Check health
echo ""
echo "6. Health check:"
npx tsx src/cli/index.ts health check 2>&1 | tail -10

echo ""
echo "=== Lifecycle Test Complete ==="