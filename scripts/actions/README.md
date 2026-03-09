# ClawSQL Action Scripts

Modular, testable action scripts for ClawSQL operations.

## Usage

Each action can be run independently:

```bash
# Show current topology
bash scripts/actions/show-topology.sh

# Show ProxySQL routing
bash scripts/actions/show-routing.sh

# Perform controlled switchover (auto-select)
bash scripts/actions/do-switchover.sh a

# Perform controlled switchover (interactive)
bash scripts/actions/do-switchover.sh

# Simulate failover
bash scripts/actions/do-failover.sh y

# Rollback failover (restart stopped primary)
bash scripts/actions/do-failover-rollback.sh y

# Rollback to original primary
bash scripts/actions/do-rollback.sh y

# Health check
bash scripts/actions/do-health.sh

# Full component check
bash scripts/actions/full-check.sh
```

## Actions

| Action | Description | Args |
|--------|-------------|------|
| `show-topology.sh` | Display MySQL replication topology from Orchestrator | none |
| `show-routing.sh` | Display ProxySQL server routing configuration | none |
| `do-switchover.sh` | Perform graceful switchover to a replica | optional: replica number or 'a' for auto |
| `do-failover.sh` | Simulate primary failure and test recovery | optional: 'y' to skip confirmation |
| `do-failover-rollback.sh` | Restart stopped primary and reintegrate as replica | optional: 'y' to skip confirmation |
| `do-rollback.sh` | Rollback switchover to restore mysql-primary as primary | optional: 'y' to skip confirmation |
| `do-health.sh` | Run health check via OpenClaw or locally | none |
| `full-check.sh` | Run comprehensive component check | none |

## Exit Codes

- `0` - Success
- `1` - Failure or cancelled

## Test Runner

Run all non-destructive actions:

```bash
bash scripts/test-actions.sh
```

Run with interactive tests:

```bash
bash scripts/test-actions.sh --interactive
```

## Key Changes

### Multi-Master Detection

The `do-switchover.sh` script now checks for multi-master conditions before attempting switchover. If multiple writable instances are detected, it will:

1. Report the error clearly
2. List which instances are writable
3. Suggest remediation steps
4. Abort the switchover to prevent data inconsistency

This prevents the error: "Cannot deduce cluster master - Found 2 potential masters"
