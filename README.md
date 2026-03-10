# ClawSQL

**AI-Driven MySQL Cluster Management with ProxySQL**

ClawSQL is a TypeScript service that provides AI-powered MySQL cluster management, including automatic failover detection, traffic routing updates via ProxySQL, and natural language SQL queries.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        clawsql network                           │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ mysql-primary│  │mysql-replica-1│  │mysql-replica-2│           │
│  │  :3306       │  │  :3306       │  │  :3306        │           │
│  │  sid=100     │  │  sid=201     │  │  sid=202      │           │
│  │  read_only=0 │  │  read_only=1 │  │  read_only=1  │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘           │
│         │   GTID repl     │   GTID repl     │                   │
│         ◄─────────────────┘                 │                   │
│         ◄───────────────────────────────────┘                   │
│                                                                  │
│  ┌────────────────┐   ┌─────────────────────────────────────┐   │
│  │    proxysql    │   │  ClawSQL Service (TypeScript)       │   │
│  │  :6033 (mysql) │   │  - Topology monitoring               │   │
│  │  :6032 (admin) │◄──│  - AI-powered analysis               │   │
│  └────────────────┘   │  - Natural language SQL              │   │
│                       │  - Automatic failover detection       │   │
│                       │  - ProxySQL routing management        │   │
│                       └─────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘

Host port mapping:
  3307 → mysql-primary:3306
  3308 → mysql-replica-1:3306
  3309 → mysql-replica-2:3306
  6033 → proxysql:6033        (Application entry point)
  6032 → proxysql:6032        (Admin SQL)
  8080 → ClawSQL API
```

---

## Features

- **Topology Monitoring**: Real-time monitoring of MySQL replication topology
- **AI-Powered Analysis**: Natural language queries and intelligent recommendations
- **Automatic Failover**: Detect primary failure and update ProxySQL routing
- **Memory Service**: Schema-aware query assistance with learning capabilities
- **SQL Interface**: Natural language to SQL translation

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build the project
npm run build

# 3. Start MySQL cluster
docker-compose up -d

# 4. Start ClawSQL service
npm run serve
```

---

## CLI Usage

```bash
# Interactive shell
npm run shell

# Check cluster status
npm run cli -- status

# Show topology
npm run cli -- topology

# Natural language query
npm run cli -- ask "show me all databases"
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/topology` | GET | Get current topology |
| `/api/sql` | POST | Natural language SQL query |
| `/api/failover` | POST | Trigger failover |

---

## Configuration

Configuration is loaded from `config/default.yaml`:

```yaml
cluster:
  name: clawsql-demo

mysql:
  user: root
  password: root_pass

proxysql:
  host: proxysql
  adminPort: 6032
  dataPort: 6033

ai:
  provider: anthropic
  apiKey: ${ANTHROPIC_API_KEY}
  model: ${ANTHROPIC_MODEL:-claude-sonnet-4-6}
```

Override with `config/local.yaml` or environment variables.

---

## Project Structure

```
ClawSQL-Demo/
├── src/                    # TypeScript source
│   ├── api/               # REST API server
│   ├── cli/               # CLI interface
│   ├── providers/         # MySQL, ProxySQL, AI providers
│   ├── services/          # Core business logic
│   └── types/             # TypeScript types
├── dist/                   # Compiled JavaScript
├── config/                 # Configuration files
│   ├── default.yaml       # Default configuration
│   ├── local.yaml         # Local overrides
│   └── mysql/             # MySQL Docker configs
├── scripts/                # Test and demo scripts
├── package.json
├── tsconfig.json
└── docker-compose.yml
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/setup.sh` | Start MySQL cluster |
| `scripts/check.sh` | Check cluster health |
| `scripts/demo.sh` | Run failover demo |
| `scripts/teardown.sh` | Stop and cleanup |

---

## Development

```bash
# Development mode with auto-reload
npm run dev

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

---

## License

MIT