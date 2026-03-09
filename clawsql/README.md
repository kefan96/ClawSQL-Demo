# ClawSQL

MySQL cluster management with AI-powered failover.

## What it does

- **Discovers topology** - Finds primary and replicas automatically
- **Manages failover** - Graceful switchover and emergency failover
- **Syncs ProxySQL** - Updates routing after topology changes
- **AI integration** - Topology analysis and recommendations via Claude/OpenAI

## Quick Start

```bash
# Build
npm install
npm run build

# Show topology
node dist/cli/index.js topology show

# Perform switchover
node dist/cli/index.js switchover --target mysql-replica-1

# Start API server
node dist/cli/index.js serve
```

## CLI Commands

```
clawsql topology show          # Show current topology
clawsql topology discover      # Discover from seed hosts
clawsql topology watch         # Watch for changes

clawsql switchover             # Graceful switchover
clawsql switchover --dry-run   # Check if switchover possible
clawsql switchover --target <host>  # Promote specific host

clawsql failover --force       # Emergency failover

clawsql routing show           # Show ProxySQL routing
clawsql routing sync           # Sync with topology

clawsql health check           # Check cluster health

clawsql ai analyze             # AI topology analysis
clawsql ai recommend           # Failover recommendations

clawsql serve                  # Start REST API server
clawsql config show            # Show configuration
```

## REST API

```
GET  /api/topology              # Current topology
POST /api/topology/discover     # Trigger discovery

POST /api/failover/switchover   # Graceful switchover
POST /api/failover/failover     # Emergency failover

GET  /api/routing               # ProxySQL routing
POST /api/routing/sync          # Sync with topology

GET  /api/health                # Health check

POST /api/ai/analyze            # AI analysis
```

## Configuration

Create `config/default.yaml`:

```yaml
cluster:
  name: my-cluster
  seeds:
    - mysql-primary:3306

mysql:
  user: root
  password: root_pass
  connectionPool: 10

proxysql:
  host: proxysql
  adminPort: 6032
  user: admin
  password: admin_pass
  hostgroups:
    writer: 10
    reader: 20

failover:
  enabled: true
  autoFailover: false
  maxLagSeconds: 5

ai:
  provider: anthropic
  apiKey: ${ANTHROPIC_API_KEY}
```

## Docker

```bash
# Build image
docker build -t clawsql .

# Run in Docker network
docker run --rm --network my-network clawsql topology show
```

## Architecture

```
src/
├── cli/           # CLI commands (Commander)
├── api/           # REST API (Fastify)
├── providers/     # MySQL, ProxySQL, AI clients
├── services/      # Topology, Failover, Health
├── events/        # Event bus, webhooks
└── config/        # Configuration loader
```

## License

MIT