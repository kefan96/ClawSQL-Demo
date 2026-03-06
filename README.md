# ClawSQL

**AI-Driven MySQL Cluster Management with OpenClaw + Orchestrator + ProxySQL**

ClawSQL is an open-source demo project showing how to use OpenClaw's Skill mechanism to coordinate Orchestrator's failover events with ProxySQL's traffic routing, making AI the operational control plane for MySQL clusters.

The project itself contains no daemon. OpenClaw is the control plane, and four Skills comprise all the execution logic.

**默认使用 Alibaba DashScope (Qwen 模型) 作为 AI 提供者。**

---

## Architecture

### Deployment Diagram

```
docker-compose.yml — 7 containers, 1 bridge network (clawsql)

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
│  ┌────────────────┐   ┌────────────────┐   ┌─────────────────┐  │
│  │ orchestrator-db│   │  orchestrator  │   │    proxysql     │  │
│  │  :3306         │   │  :3000         │   │  :6033 (mysql)  │  │
│  │  (metadata)    │◄──│  poll 5s       │   │  :6032 (admin)  │  │
│  └────────────────┘   └───────┬────────┘   └─────────────────┘  │
│                               │                                  │
│                       webhook │ POST                             │
│                               ▼                                  │
│                      ┌─────────────────┐                        │
│                      │    openclaw     │                        │
│                      │  (gateway)      │                        │
│                      │  :3100          │                        │
│                      │  skills mounted │                        │
│                      └─────────────────┘                        │
└──────────────────────────────────────────────────────────────────┘

Host port mapping:
  3307 → mysql-primary:3306
  3308 → mysql-replica-1:3306
  3309 → mysql-replica-2:3306
  3000 → orchestrator:3000    (Web UI + REST API)
  6033 → proxysql:6033        (Application entry point)
  6032 → proxysql:6032        (Admin SQL)
  3100 → openclaw:3100        (OpenClaw Gateway - loopback)
```

### Failover Data Flow

The core path from failure detection to traffic routing:

```
  mysql-primary crashes
        │
        ▼
  Orchestrator (InstancePollSeconds=5)
  Detects DeadMaster
        │
        ▼
  Orchestrator executes built-in recovery
  Elects replica → CHANGE MASTER TO → SET read_only=0
        │
        ▼
  PostFailoverProcesses triggers webhook
  POST http://openclaw:3100/hooks/agent
  payload:
  ┌──────────────────────────────────────┐
  │ {                                    │
  │   "skill": "mysql-failover",         │
  │   "failureType": "DeadMaster",       │
  │   "failedHost": "mysql-primary",     │
  │   "failedPort": 3306,                │
  │   "successorHost": "mysql-replica-1",│
  │   "successorPort": 3306,             │
  │   "isSuccessful": true,              │
  │   "isMaster": true,                  │
  │   "recoveryUID": "..."               │
  │ }                                    │
  └──────────────┬───────────────────────┘
                 │
                 ▼
  OpenClaw loads mysql-failover Skill
  AI reads Decision Logic from SKILL.md
        │
        ▼
  AI calls tools from handler.mjs based on decision tree:
  ┌──────────────────────────────────────────────────┐
  │ 1. get_proxysql_servers()                        │
  │    → SELECT * FROM mysql_servers (via 6032)      │
  │                                                  │
  │ 2. switch_writer(                                │
  │      "mysql-primary", 3306,                      │
  │      "mysql-replica-1", 3306                     │
  │    )                                             │
  │    → DELETE old writer from HG 10                │
  │    → REPLACE old writer into HG 20 (becomes reader)│
  │    → DELETE new writer from HG 20                │
  │    → REPLACE new writer into HG 10               │
  │    → LOAD MYSQL SERVERS TO RUNTIME               │
  │    → SAVE MYSQL SERVERS TO DISK                  │
  │                                                  │
  │ 3. remove_failed_server("mysql-primary", 3306)   │
  │    → DELETE FROM mysql_servers WHERE hostname=... │
  │    → LOAD + SAVE                                 │
  │                                                  │
  │ 4. verify_routing()                              │
  │    → Check HG10 has exactly 1 ONLINE writer      │
  │    → Check HG20 has at least 1 ONLINE reader     │
  │    → Return issues list                          │
  └──────────────────────────────────────────────────┘
        │
        ▼
  ProxySQL routing updated
  Applications via :6033 automatically route to new primary
```

### Skill and Component Interaction

```
                        ┌──────────────────────────────────┐
                        │           OpenClaw               │
                        │                                  │
   Orchestrator         │   ┌──────────────────────────┐   │
   PostFailover    ─────┼──►│  mysql-failover          │   │
   webhook              │   │  trigger: webhook        │   │
                        │   │  5 tools                 │   │
                        │   └─────────┬────────────────┘   │
                        │             │                    │
   cron */5 * * * *     │   ┌─────────▼────────────────┐   │
   (internal)      ─────┼──►│  mysql-health            │   │
                        │   │  trigger: cron           │   │
                        │   │  4 tools                 │   │
                        │   └─────────┬────────────────┘   │
                        │             │                    │
   User chat in         │   ┌─────────▼────────────────┐   │
   OpenClaw UI   ───────┼──►│  mysql-topology          │   │
                        │   │  trigger: chat           │   │
                        │   │  6 tools                 │   │
                        │   └─────────┬────────────────┘   │
                        │             │                    │
   User chat in         │   ┌─────────▼────────────────┐   │
   OpenClaw UI   ───────┼──►│  mysql-traffic           │   │
                        │   │  trigger: chat           │   │
                        │   │  7 tools                 │   │
                        │   └─────────┬────────────────┘   │
                        │             │                    │
                        └─────────────┼────────────────────┘
                                      │
                          ┌───────────┴───────────┐
                          ▼                       ▼
                 ┌─────────────────┐    ┌──────────────────┐
                 │  Orchestrator   │    │    ProxySQL       │
                 │  REST API       │    │    Admin SQL      │
                 │  :3000          │    │    :6032          │
                 │                 │    │                   │
                 │ GET /api/       │    │ SELECT/INSERT/    │
                 │   cluster/      │    │ DELETE/UPDATE     │
                 │   instance/     │    │ mysql_servers     │
                 │   discover/     │    │                   │
                 │   relocate/     │    │ LOAD ... RUNTIME  │
                 │   begin-        │    │ SAVE ... DISK     │
                 │   downtime/     │    │                   │
                 └─────────────────┘    └──────────────────┘
```

---

## Skill Implementation Details

### mysql-failover

Trigger: Orchestrator webhook via `PostFailoverProcesses` / `PostUnsuccessfulFailoverProcesses`.

Three decision branches defined in SKILL.md:

| Scenario | Condition | AI executes |
|----------|-----------|-------------|
| Primary failure, recovery success | `isMaster=true, isSuccessful=true` | `get_proxysql_servers` → `switch_writer` → `remove_failed_server` → `verify_routing` |
| Primary failure, recovery failed | `isMaster=true, isSuccessful=false` | `get_proxysql_servers` → `remove_failed_server` → report no writer |
| Replica failure | `isMaster=false` | `remove_failed_server` → `verify_routing` |

5 tool functions in handler.mjs:

| Tool | Purpose | Underlying call |
|------|---------|-----------------|
| `get_proxysql_servers` | View current ProxySQL routing table | `SELECT * FROM mysql_servers` |
| `switch_writer` | Atomic writer switch (4 SQL steps) | DELETE HG10 → REPLACE HG20 → DELETE HG20 → REPLACE HG10 → LOAD+SAVE |
| `remove_failed_server` | Remove failed node from all hostgroups | `DELETE FROM mysql_servers WHERE hostname=...` → LOAD+SAVE |
| `verify_routing` | Verify routing consistency | Query mysql_servers, check writer/reader counts |
| `get_orchestrator_topology` | Cross-validate Orchestrator topology | `GET /api/cluster/{alias}` |

### mysql-health

Trigger: OpenClaw cron, every 5 minutes.

Severity levels defined in SKILL.md:

| Level | Conditions |
|-------|------------|
| CRITICAL | SQL/IO thread stopped, lag > 30s, no ProxySQL writer, component unreachable |
| WARNING | lag > 5s, connection usage > 80%, has problems, multiple writers |
| HEALTHY | None of the above |

4 tool functions in handler.mjs:

| Tool | Purpose | Underlying call |
|------|---------|-----------------|
| `check_orchestrator_health` | Orchestrator connectivity | `GET /api/health` |
| `check_proxysql_health` | ProxySQL connectivity | `SELECT 1` via 6032 |
| `check_replication_status` | Topology + lag/thread/gtid/problems per replica | `GET /api/cluster/{alias}` |
| `check_connection_pool` | ProxySQL connection pool stats | `SELECT * FROM stats_mysql_connection_pool` |

### mysql-topology

Trigger: User chat in OpenClaw (e.g., "show topology", "discover new instance").

6 tool functions in handler.mjs:

| Tool | Purpose | Orchestrator API |
|------|---------|------------------|
| `get_topology` | Full topology tree | `GET /api/cluster/{alias}` |
| `get_instance_detail` | Single instance details (UUID, GTID, semi-sync, uptime...) | `GET /api/instance/{host}/{port}` |
| `discover_instance` | Register new instance to Orchestrator | `GET /api/discover/{host}/{port}` |
| `relocate_instance` | Change replication topology (attach to different parent) | `GET /api/relocate/{h}/{p}/{bh}/{bp}` |
| `begin_downtime` | Mark maintenance window (Orchestrator skips this instance) | `GET /api/begin-downtime/...` |
| `end_downtime` | End maintenance window | `GET /api/end-downtime/{h}/{p}` |

### mysql-traffic

Trigger: User chat in OpenClaw (e.g., "view routing", "add a reader").

7 tool functions in handler.mjs:

| Tool | Purpose | ProxySQL SQL |
|------|---------|-------------|
| `get_servers` | Current all server entries | `SELECT * FROM mysql_servers` |
| `get_pool_stats` | Connection pool real-time stats | `SELECT * FROM stats_mysql_connection_pool` |
| `get_query_rules` | Query routing rules list | `SELECT * FROM mysql_query_rules` |
| `add_server` | Add server to specified hostgroup | `INSERT INTO mysql_servers ...` → LOAD+SAVE |
| `remove_server` | Remove server (can specify hostgroup) | `DELETE FROM mysql_servers ...` → LOAD+SAVE |
| `switch_writer` | Atomic writer switch | Same as mysql-failover's switch_writer |
| `set_server_status` | Change server status (ONLINE/OFFLINE_SOFT/OFFLINE_HARD) | `UPDATE mysql_servers SET status=...` → LOAD+SAVE |

---

## Shared Client Libraries

Four Skills' handlers operate external components via `skills/lib/`:

### orchestrator-client.mjs

Calls Orchestrator REST API via HTTP `fetch`. Environment variable `ORCHESTRATOR_URL` controls address (default `http://orchestrator:3000`). 10-second timeout per request (AbortController).

Exports 15 functions: `getClusterInstances`, `getClusterInfo`, `getInstance`, `discoverInstance`, `getClusters`, `relocateInstance`, `setReadOnly`, `setWriteable`, `recover`, `forceMasterFailover`, `gracefulMasterTakeover`, `ackRecovery`, `beginDowntime`, `endDowntime`, `getTopology` (convenience wrapper), `healthCheck`.

### proxysql-client.mjs

Connects to ProxySQL Admin port (6032) via `mysql2/promise`. Environment variables `PROXYSQL_HOST`, `PROXYSQL_PORT`, `PROXYSQL_USER`, `PROXYSQL_PASSWORD` control connection parameters. Connection pool limit 3.

Exports 15 functions: `getServers`, `getWriters`, `getReaders`, `addServer`, `removeServer`, `setServerStatus`, `switchWriter` (4-step atomic operation), `getPoolStats`, `getActiveConnections`, `getQueryRules`, `loadServers`, `loadQueryRules`, `ping`, `destroy`. Constants `HG_WRITER=10`, `HG_READER=20`, `HG_BACKUP=30`.

Key implementation — `switchWriter` 4-step atomic switch:

```sql
-- 1. Remove old primary from writer group
DELETE FROM mysql_servers WHERE hostname='old' AND port=3306 AND hostgroup_id=10;
-- 2. Demote old primary to reader
REPLACE INTO mysql_servers (hostgroup_id,hostname,port,weight,max_connections) VALUES (20,'old',3306,1000,200);
-- 3. Remove new primary from reader group
DELETE FROM mysql_servers WHERE hostname='new' AND port=3306 AND hostgroup_id=20;
-- 4. Promote new primary to writer
REPLACE INTO mysql_servers (hostgroup_id,hostname,port,weight,max_connections) VALUES (10,'new',3306,1000,200);
-- 5. Apply + persist
LOAD MYSQL SERVERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
```

---

## Infrastructure Configuration

### MySQL Cluster

| Parameter | Primary | Replica-1 | Replica-2 |
|-----------|---------|-----------|-----------|
| server_id | 100 | 201 | 202 (command override) |
| gtid_mode | ON | ON | ON |
| binlog_format | ROW | ROW | ROW |
| log_slave_updates | ON | ON | ON |
| read_only | 0 | 1 | 1 |
| super_read_only | 0 | 1 | 1 |
| report_host | mysql-primary | mysql-replica-1 | mysql-replica-2 (command override) |

Replication: GTID auto-positioning (`MASTER_AUTO_POSITION=1`), replica automatically executes `CHANGE MASTER TO` + `START SLAVE` on startup.

Initialization users (init-primary.sql creates on primary, replica syncs via replication):

| User | Password | Privileges | Purpose |
|------|----------|------------|---------|
| `repl` | `repl_pass` | REPLICATION SLAVE | GTID replication |
| `orchestrator` | `orch_pass` | SUPER, PROCESS, REPLICATION SLAVE/CLIENT, RELOAD, SELECT on mysql.slave_master_info | Orchestrator topology discovery |
| `proxysql_mon` | `mon_pass` | REPLICATION CLIENT | ProxySQL monitor module |
| `app` | `app_pass` | ALL PRIVILEGES | Application connections |

### Orchestrator

| Configuration | Value | Description |
|---------------|-------|-------------|
| InstancePollSeconds | 5 | Probe MySQL instances every 5 seconds |
| RecoveryPeriodBlockSeconds | 60 | Recovery cooldown period |
| RecoverMasterClusterFilters | ["*"] | Allow automatic recovery for all clusters |
| DiscoverByShowSlaveHosts | true | Auto-discover via SHOW SLAVE HOSTS |
| MySQLHostnameResolveMethod | none | Skip hostname resolution in container environment |
| Backend DB | orchestrator-db:3306 | Independent MySQL instance for Orchestrator metadata |

Hooks configuration — Orchestrator executes curl after recovery complete/failed:

```
PostFailoverProcesses:
  → POST http://openclaw:3100/hooks/agent
  → JSON body with Authorization header: Bearer clawsql-webhook-secret + skill, failureType, failedHost/Port, successorHost/Port, isSuccessful, isMaster, etc.

PostUnsuccessfulFailoverProcesses:
  → Same as above, isSuccessful=false
```

### ProxySQL

| Configuration | Value |
|---------------|-------|
| Admin port | 6032, user admin/admin_pass |
| MySQL protocol port | 6033, application connects via this port |
| Monitor user | proxysql_mon/mon_pass |
| monitor_read_only_interval | 1500ms (detect read_only changes) |
| monitor_ping_interval | 10000ms |

Hostgroup and Server initial configuration:

| Hostgroup | Purpose | Initial members |
|-----------|---------|-----------------|
| HG 10 (Writer) | Write + SELECT FOR UPDATE | mysql-primary:3306 |
| HG 20 (Reader) | Regular SELECT | mysql-replica-1:3306, mysql-replica-2:3306 |
| HG 30 (Backup) | Reserved | None |

Query Rules:

| Rule ID | Match | Destination |
|---------|-------|-------------|
| 100 | `^SELECT .* FOR UPDATE$` | HG 10 (writer) |
| 200 | `^SELECT` | HG 20 (reader) |

Application user: `app/app_pass`, default_hostgroup=10 (non-SELECT goes to writer).

---

## Quick Start

```bash
git clone https://github.com/clawsql/clawsql.git
cd clawsql

# 1. Set DashScope API key (get from https://help.aliyun.com/zh/model-studio/)
export DASHSCOPE_API_KEY=sk-your-key-here

# 2. Start all 7 containers
bash scripts/setup.sh
#    Wait for MySQL healthy → Verify replication → Discover instances → Show initial state

# 3. Check cluster health
bash scripts/check-cluster.sh

# 4. Demo failover (docker stop primary → wait 30s → view results)
bash scripts/demo-failover.sh

# 5. Cleanup (delete containers + volumes)
bash scripts/teardown.sh
```

### Port Quick Reference

| Port | Service | Purpose |
|------|---------|---------|
| 3307 | mysql-primary | MySQL direct connection |
| 3308 | mysql-replica-1 | MySQL direct connection |
| 3309 | mysql-replica-2 | MySQL direct connection |
| 3000 | orchestrator | Web UI + REST API |
| 6033 | proxysql | Application MySQL entry point (read/write split) |
| 6032 | proxysql | Admin SQL interface |
| 3100 | openclaw | OpenClaw Gateway (loopback only) |

---

## Project Structure

```
clawsql/
├── docker-compose.yml                 # 7-container orchestration
├── config/
│   ├── mysql/
│   │   ├── primary.cnf                # sid=100, GTID, read_only=0
│   │   ├── replica.cnf                # sid=201, GTID, read_only=1
│   │   ├── init-primary.sql           # 4 users + demo database
│   │   └── init-replica.sql           # CHANGE MASTER TO + START SLAVE
│   ├── orchestrator/
│   │   └── orchestrator.conf.json     # poll 5s, hooks → OpenClaw
│   └── proxysql/
│       └── proxysql.cnf               # HG10/20, query rules, monitor
├── skills/
│   ├── package.json                   # dependencies: mysql2
│   ├── lib/
│   │   ├── orchestrator-client.mjs    # 15 functions, fetch → Orchestrator REST
│   │   ├── proxysql-client.mjs        # 15 functions, mysql2 → ProxySQL Admin SQL
│   │   └── utils.mjs                  # formatting + utilities
│   ├── mysql-failover/
│   │   ├── SKILL.md                   # webhook trigger, 3 decision branches
│   │   └── handler.mjs                # 5 tools: switch_writer, verify_routing...
│   ├── mysql-health/
│   │   ├── SKILL.md                   # cron */5, CRITICAL/WARNING/HEALTHY
│   │   └── handler.mjs                # 4 tools: check_replication, check_pool...
│   ├── mysql-topology/
│   │   ├── SKILL.md                   # chat trigger, topology management
│   │   └── handler.mjs                # 6 tools: discover, relocate, downtime...
│   ├── mysql-traffic/
│   │   ├── SKILL.md                   # chat trigger, routing management
│   │   └── handler.mjs                # 7 tools: add/remove server, switch...
│   └── mysql-demo/                    # Interactive demo skill
│       ├── SKILL.md                   # chat/webhook trigger, demo actions
│       └── handler.mjs                # 8 tools: health check, switchover...
├── scripts/
│   ├── setup.sh                       # start + wait + discover + verify
│   ├── demo-failover.sh               # kill primary → observe recovery → check routing
│   ├── check-cluster.sh               # component health quick check
│   ├── teardown.sh                    # docker compose down -v
│   ├── init-openclaw.sh               # initialize OpenClaw configuration
│   ├── demo-runner.sh                 # Interactive demo menu
│   └── demo-actions/                  # Demo action scripts
│       ├── demo-health-check.sh       # Health check with AI analysis
│       └── demo-switchover.sh         # Controlled switchover demo
├── config/openclaw/                   # OpenClaw configuration for ClawSQL
│   └── openclaw.json                  # DashScope + hooks configuration
├── .env.example
├── .gitignore
└── README.md
```

## RDS MySQL Compatibility

RDS MySQL native replication instances have high-privilege accounts with `RESET SLAVE`, `CHANGE MASTER TO`, `SET GLOBAL read_only=0` permissions. This means Orchestrator can directly manage RDS instance replication topology and failover, and ClawSQL's Skill system can be applied to cross-cloud/hybrid-cloud RDS MySQL clusters without any modifications.

## License

Apache License 2.0

---

## Troubleshooting

### Webhook Integration Issues

If automatic failover via OpenClaw webhooks is not working:

1. **Check DASHSCOPE_API_KEY**: The webhook endpoint requires a valid DashScope API key for AI processing. Set `DASHSCOPE_API_KEY` in your environment:
   ```bash
   export DASHSCOPE_API_KEY=sk-your-key-here
   ```

2. **Verify OpenClaw gateway status**:
   ```bash
   openclaw gateway status
   # Should show: Runtime: running, RPC probe: ok
   ```

3. **Check OpenClaw is listening on port 3100**:
   ```bash
   ss -tlnp | grep 3100
   # Should show listening on 127.0.0.1:3100
   ```

4. **Test webhook endpoint manually**:
   ```bash
   curl -X POST http://localhost:3100/hooks/agent \
     -H 'Content-Type: application/json' \
     -H 'Authorization: Bearer clawsql-webhook-secret' \
     -d '{"skill":"mysql-health","request":"check health"}'
   ```

5. **Manual failover**: If webhooks fail, manually update ProxySQL routing:
   ```bash
   docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass \
     -e "DELETE FROM mysql_servers WHERE hostname='mysql-primary' AND hostgroup_id=10;
         REPLACE INTO mysql_servers (hostgroup_id,hostname,port,weight,max_connections)
         VALUES (20,'mysql-primary',3306,1000,200);
         DELETE FROM mysql_servers WHERE hostname='mysql-replica-2' AND hostgroup_id=20;
         REPLACE INTO mysql_servers (hostgroup_id,hostname,port,weight,max_connections)
         VALUES (10,'mysql-replica-2',3306,1000,200);
         LOAD MYSQL SERVERS TO RUNTIME;
         SAVE MYSQL SERVERS TO DISK;"
   ```

### MySQL Replication Issues

If replication shows `IO=Connecting` or errors:

1. **Authentication plugin**: MySQL 8 uses `caching_sha2_password` which requires SSL. Fix by running:
   ```bash
   docker exec clawsql-primary mysql -uroot -proot_pass \
     -e "ALTER USER 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl_pass'; FLUSH PRIVILEGES;"
   docker exec clawsql-replica-1 mysql -uroot -proot_pass -e "STOP SLAVE; START SLAVE;"
   docker exec clawsql-replica-2 mysql -uroot -proot_pass -e "STOP SLAVE; START SLAVE;"
   ```

2. **Check replication status**:
   ```bash
   docker exec clawsql-replica-1 mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G"
   ```
   Look for `Slave_IO_Running: Yes` and `Slave_SQL_Running: Yes`.

---

## 🎮 Interactive Demo Guide

### Demo Menu

The easiest way to explore ClawSQL is through the interactive demo menu:

```bash
bash scripts/demo-runner.sh
```

**Menu Options:**

| Option | Action | Description |
|--------|--------|-------------|
| 1 | 📊 Cluster Health Check | Gather metrics and request AI analysis from OpenClaw |
| 2 | 🔄 Controlled Switchover | Promote a replica to new primary |
| 3 | 👁️ View Current Topology | Display replication tree from Orchestrator |
| 4 | 📝 Test Read/Write Splitting | Verify ProxySQL routing works correctly |
| 5 | 🤖 Send Webhook to OpenClaw | Interact with AI agent directly |
| 6 | 📋 ProxySQL Routing View | Show current writer/reader configuration |
| 7 | 🔍 Replication Lag Monitor | Real-time lag monitoring (Ctrl+C to stop) |

### Sending Webhooks to OpenClaw

Interact with the OpenClaw AI agent via webhooks:

```bash
# Health check request
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-health","request":"check cluster health and provide analysis"}'

# Topology request
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-topology","request":"show current replication topology"}'

# Switchover demo (promotes replica-1)
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-demo","action":"switchover","target":"mysql-replica-1"}'
```

### Demo Scripts

| Script | Description |
|--------|-------------|
| `scripts/demo-actions/demo-health-check.sh` | Quick health check with cluster metrics |
| `scripts/demo-actions/demo-switchover.sh` | Controlled switchover demonstration |
| `scripts/demo-runner.sh` | Interactive menu for all demos |
| `scripts/demo-failover.sh` | Simulate primary failure and observe auto-recovery |

---

## 📖 Step-by-Step Tutorial

### Step 1: Initial Setup

```bash
# Set your DashScope API key
export DASHSCOPE_API_KEY=sk-your-key-here

# Start the cluster
bash scripts/setup.sh
```

Expected output:
```
╔══════════════════════════════════════════╗
║            Setup Complete!               ║
╠══════════════════════════════════════════╣
║  MySQL Primary:  localhost:3307           ║
║  Replica 1:      localhost:3308           ║
║  Replica 2:      localhost:3309           ║
║  ProxySQL:       localhost:6033 (mysql)   ║
║  ProxySQL Admin: localhost:6032           ║
║  Orchestrator:   http://localhost:3000    ║
║  OpenClaw:       http://localhost:3100    ║
╚══════════════════════════════════════════╝
```

### Step 2: Verify Cluster Health

```bash
bash scripts/check-cluster.sh
```

You should see all components healthy:
- ✅ Orchestrator reachable with cluster discovered
- ✅ ProxySQL with 1 writer + 2 readers ONLINE
- ✅ All MySQL instances with correct roles
- ✅ Replication IO=Yes SQL=Yes Lag=0s

### Step 3: Test Read/Write Splitting

```bash
# Connect through ProxySQL (port 6033)
docker exec clawsql-primary mysql -hproxysql -P6033 -uroot -proot_pass -e "
  -- This SELECT goes to a replica
  SELECT @@hostname as connected_host;

  -- This INSERT goes to the primary
  CREATE DATABASE IF NOT EXISTS test;
  USE test;
  CREATE TABLE demo (id INT PRIMARY KEY, value VARCHAR(100));
  INSERT INTO demo VALUES (1, 'hello ClawSQL');
  SELECT * FROM demo;
"

# Verify data replicated to all nodes
docker exec clawsql-replica-1 mysql -uroot -proot_pass -e "SELECT * FROM test.demo"
docker exec clawsql-replica-2 mysql -uroot -proot_pass -e "SELECT * FROM test.demo"
```

### Step 4: View Current Topology

```bash
# Via Orchestrator API
curl -s http://localhost:3000/api/cluster/alias/mysql-primary:3306 | python3 -m json.tool

# Or use the demo menu
bash scripts/demo-runner.sh  # Option 3: View Topology
```

### Step 5: Controlled Switchover Demo

```bash
# Run the switchover script
bash scripts/demo-actions/demo-switchover.sh
```

This will:
1. Verify replication is healthy
2. Notify OpenClaw via webhook
3. Use Orchestrator to perform graceful master takeover
4. Update ProxySQL routing automatically
5. Verify the new topology

### Step 6: Simulate Primary Failure

```bash
# Run the failover demo
bash scripts/demo-failover.sh

# Or manually stop the primary
docker stop clawsql-primary

# Wait ~30 seconds for Orchestrator to detect and recover
# Watch the webhook trigger OpenClaw skill execution

# Check the new topology
curl -s http://localhost:3000/api/cluster/alias/mysql-primary:3306 | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data:
    print(f'New Primary: {data[0][\"Key\"][\"Hostname\"]}')
    for r in data[0].get('Replicas', []):
        print(f'  Replica: {r[\"Key\"][\"Hostname\"]}')
"
```

### Step 7: Query OpenClaw AI

```bash
# Ask for health analysis
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-health","request":"analyze the cluster and report any issues"}'

# Ask for topology visualization
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-topology","request":"show me the replication topology in a tree format"}'

# Ask for switchover assistance
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-demo","request":"help me perform a controlled switchover to mysql-replica-1"}'
```

---

## 🔧 Hands-On Exercises

### Exercise 1: Add a Write and Verify Replication

```bash
# Write to primary via ProxySQL
docker exec clawsql-primary mysql -hproxysql -P6033 -uroot -proot_pass -e "
  CREATE DATABASE IF NOT EXISTS exercise1;
  USE exercise1;
  CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100));
  INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie');
"

# Verify on all replicas
for host in clawsql-primary clawsql-replica-1 clawsql-replica-2; do
  echo "=== $host ==="
  docker exec "$host" mysql -uroot -proot_pass -e "SELECT * FROM exercise1.users"
done
```

### Exercise 2: Observe ProxySQL Query Routing

```bash
# Check which queries go to writer vs readers
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
  SELECT hostgroup_id, hostname, status, max_connections
  FROM mysql_servers ORDER BY hostgroup_id
"

# Writers (HG 10) receive: INSERT, UPDATE, DELETE, SELECT FOR UPDATE
# Readers (HG 20) receive: SELECT

# Test read routing (should go to replica)
docker exec clawsql-primary mysql -hproxysql -P6033 -uroot -proot_pass -e "SELECT @@hostname"

# Test write routing (must go to primary)
docker exec clawsql-primary mysql -hproxysql -P6033 -uroot -proot_pass -e "INSERT INTO exercise1.users (name) VALUES ('Test')"
```

### Exercise 3: Perform Manual Switchover

```bash
# Use Orchestrator API for graceful takeover
curl -X POST "http://localhost:3000/api/graceful-master-takeover-auto/mysql-primary:3306" \
  -H "Content-Type: application/json" \
  -d '{"targetHost":"mysql-replica-1","targetPort":3306}'

# Verify new topology
curl -s http://localhost:3000/api/clusters

# Update ProxySQL manually if needed
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
  -- Remove old writer from HG10
  DELETE FROM mysql_servers WHERE hostname='mysql-primary' AND hostgroup_id=10;
  -- Add old writer to HG20 (becomes reader)
  REPLACE INTO mysql_servers VALUES (20,'mysql-primary',3306,'ONLINE',1000,0,200,0,0,0,'');
  -- Remove new writer from HG20
  DELETE FROM mysql_servers WHERE hostname='mysql-replica-1' AND hostgroup_id=20;
  -- Add new writer to HG10
  REPLACE INTO mysql_servers VALUES (10,'mysql-replica-1',3306,'ONLINE',1000,0,200,0,0,0,'');
  LOAD MYSQL SERVERS TO RUNTIME;
  SAVE MYSQL SERVERS TO DISK;
"
```

### Exercise 4: Test Replica Failure Handling

```bash
# Simulate replica 2 failure
docker stop clawsql-replica-2

# Ask OpenClaw to analyze
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-health","request":"one replica seems down, analyze the situation"}'

# Check ProxySQL automatically removed failed replica
docker exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
  SELECT hostname, hostgroup_id, status FROM mysql_servers
"

# Restart replica
docker start clawsql-replica-2

# Wait for replication to catch up
sleep 10
docker exec clawsql-replica-2 mysql -uroot -proot_pass -e "SHOW SLAVE STATUS\G" | grep -E "Slave_(IO|SQL)_Running|Seconds_Behind_Master"
```

---

## 📋 Quick Reference Card

### Essential Commands

```bash
# Start cluster
bash scripts/setup.sh

# Check health
bash scripts/check-cluster.sh

# Interactive demo
bash scripts/demo-runner.sh

# Cleanup
bash scripts/teardown.sh
```

### Port Map

| Port | Service | Connection String |
|------|---------|-------------------|
| 3307 | MySQL Primary | `mysql -h localhost -P 3307 -uroot -proot_pass` |
| 3308 | MySQL Replica 1 | `mysql -h localhost -P 3308 -uroot -proot_pass` |
| 3309 | MySQL Replica 2 | `mysql -h localhost -P 3309 -uroot -proot_pass` |
| 6033 | ProxySQL (app) | `mysql -h localhost -P 6033 -uapp -papp_pass` |
| 6032 | ProxySQL (admin) | `mysql -h localhost -P 6032 -uadmin -padmin_pass` |
| 3000 | Orchestrator UI | http://localhost:3000 |
| 3100 | OpenClaw Gateway | http://localhost:3100 (loopback only) |

### Webhook Payloads

```bash
# Health check
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-health","request":"check health"}'

# Topology
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-topology","request":"show topology"}'

# Switchover
curl -X POST http://localhost:3100/hooks/agent \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer clawsql-webhook-secret' \
  -d '{"skill":"mysql-demo","action":"switchover","target":"mysql-replica-1"}'
```

### Orchestrator API

```bash
# List clusters
curl http://localhost:3000/api/clusters

# Get topology
curl http://localhost:3000/api/cluster/alias/mysql-primary:3306

# Discover instance
curl http://localhost:3000/api/discover/mysql-primary/3306

# Graceful switchover
curl -X POST http://localhost:3000/api/graceful-master-takeover-auto/mysql-primary:3306 \
  -H 'Content-Type: application/json' \
  -d '{"targetHost":"mysql-replica-1","targetPort":3306}'
```

### Available DashScope Models

| Model ID | Description | Context Window |
|----------|-------------|----------------|
| `dashscope/qwen-plus` | Balanced Qwen model (default) | 131K tokens |
| `dashscope/qwen-max` | Most capable Qwen model | 32K tokens |
| `dashscope/qwen-coder-plus` | Code-optimized Qwen | 131K tokens |

Get your API key from [Alibaba Cloud Model Studio](https://help.aliyun.com/zh/model-studio/).
