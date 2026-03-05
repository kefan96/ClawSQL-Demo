# ClawSQL

**OpenClaw + Orchestrator + ProxySQL — AI-Driven MySQL Cluster Management**

ClawSQL 是一个开源 demo 项目，演示如何用 OpenClaw 的 Skill 机制将 Orchestrator 的故障恢复事件与 ProxySQL 的流量路由串联起来，让 AI 作为 MySQL 集群的运维控制面。

项目本身不包含独立 daemon。OpenClaw 就是控制面，四个 Skill 就是全部执行逻辑。

---

## 架构

### 整体部署

```
docker-compose.yml — 7 个容器，1 个 bridge 网络 (clawsql)

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
│                      │  :3000          │                        │
│                      │  skills mounted │                        │
│                      └─────────────────┘                        │
└──────────────────────────────────────────────────────────────────┘

宿主机端口映射：
  3307 → mysql-primary:3306
  3308 → mysql-replica-1:3306
  3309 → mysql-replica-2:3306
  3000 → orchestrator:3000    (Web UI + REST API)
  6033 → proxysql:6033        (应用连接入口)
  6032 → proxysql:6032        (Admin SQL)
  3100 → openclaw:3000        (OpenClaw UI)
```

### 故障转移数据流

这是项目的核心路径——从故障检测到路由切换的完整链路：

```
  mysql-primary 宕机
        │
        ▼
  Orchestrator (InstancePollSeconds=5)
  检测到 DeadMaster
        │
        ▼
  Orchestrator 执行内置恢复逻辑
  选举 replica → CHANGE MASTER TO → SET read_only=0
        │
        ▼
  PostFailoverProcesses 触发
  curl -X POST http://openclaw:18789/hooks/agent
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
  OpenClaw 加载 mysql-failover Skill
  AI 读取 SKILL.md 中的 Decision Logic
        │
        ▼
  AI 按决策树调用 handler.mjs 中的 tools：
  ┌──────────────────────────────────────────────────┐
  │ 1. get_proxysql_servers()                        │
  │    → SELECT * FROM mysql_servers (via 6032)      │
  │                                                  │
  │ 2. switch_writer(                                │
  │      "mysql-primary", 3306,                      │
  │      "mysql-replica-1", 3306                     │
  │    )                                             │
  │    → DELETE old writer from HG 10                │
  │    → REPLACE old writer into HG 20 (变为reader)  │
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
  │    → 检查 HG10 有且仅有 1 个 ONLINE writer      │
  │    → 检查 HG20 至少有 1 个 ONLINE reader         │
  │    → 返回 issues 列表                            │
  └──────────────────────────────────────────────────┘
        │
        ▼
  ProxySQL 路由已更新
  应用通过 :6033 的连接自动路由到新 primary
```

### Skill 与组件交互

```
                        ┌──────────────────────────────────┐
                        │           OpenClaw                │
                        │                                  │
   Orchestrator         │   ┌──────────────────────────┐   │
   PostFailover    ─────┼──►│  mysql-failover          │   │
   webhook              │   │  trigger: webhook        │   │
                        │   │  5 tools                 │   │
                        │   └─────────┬────────────────┘   │
                        │             │                    │
   cron */5 * * * *     │   ┌─────────▼────────────────┐   │
   (OpenClaw 内部) ─────┼──►│  mysql-health            │   │
                        │   │  trigger: cron           │   │
                        │   │  4 tools                 │   │
                        │   └─────────┬────────────────┘   │
                        │             │                    │
   用户在 OpenClaw      │   ┌─────────▼────────────────┐   │
   对话中提问  ─────────┼──►│  mysql-topology          │   │
                        │   │  trigger: chat           │   │
                        │   │  6 tools                 │   │
                        │   └─────────┬────────────────┘   │
                        │             │                    │
   用户在 OpenClaw      │   ┌─────────▼────────────────┐   │
   对话中提问  ─────────┼──►│  mysql-traffic           │   │
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

## Skill 实现细节

### mysql-failover

触发方式：Orchestrator 通过 `PostFailoverProcesses` / `PostUnsuccessfulFailoverProcesses` 发送 webhook。

SKILL.md 中定义了三条决策分支，AI 根据 payload 中的 `isMaster` 和 `isSuccessful` 字段选择：

| 场景 | 条件 | AI 执行的 tools |
|------|------|----------------|
| 主库故障，恢复成功 | `isMaster=true, isSuccessful=true` | `get_proxysql_servers` → `switch_writer` → `remove_failed_server` → `verify_routing` |
| 主库故障，恢复失败 | `isMaster=true, isSuccessful=false` | `get_proxysql_servers` → `remove_failed_server` → 报告无 writer |
| 从库故障 | `isMaster=false` | `remove_failed_server` → `verify_routing` |

handler.mjs 中的 5 个 tool 函数：

| Tool | 作用 | 底层调用 |
|------|------|---------|
| `get_proxysql_servers` | 查看当前 ProxySQL 路由表 | `SELECT * FROM mysql_servers` |
| `switch_writer` | 原子切换 writer（4 步 SQL） | DELETE HG10 → REPLACE HG20 → DELETE HG20 → REPLACE HG10 → LOAD+SAVE |
| `remove_failed_server` | 从所有 hostgroup 移除故障节点 | `DELETE FROM mysql_servers WHERE hostname=...` → LOAD+SAVE |
| `verify_routing` | 校验路由一致性 | 查询 mysql_servers，检查 writer 数量、reader 数量 |
| `get_orchestrator_topology` | 交叉验证 Orchestrator 拓扑 | `GET /api/cluster/{alias}` |

### mysql-health

触发方式：OpenClaw cron，每 5 分钟执行一次。

SKILL.md 中定义了判定标准：

| 级别 | 条件 |
|------|------|
| CRITICAL | SQL/IO thread 停止、lag > 30s、ProxySQL 无 writer、组件不可达 |
| WARNING | lag > 5s、连接使用率 > 80%、有 problems、多 writer |
| HEALTHY | 以上都不满足 |

handler.mjs 中的 4 个 tool 函数：

| Tool | 作用 | 底层调用 |
|------|------|---------|
| `check_orchestrator_health` | Orchestrator 连通性 | `GET /api/health` |
| `check_proxysql_health` | ProxySQL 连通性 | `SELECT 1` via 6032 |
| `check_replication_status` | 拓扑 + 每个 replica 的 lag/thread/gtid/problems | `GET /api/cluster/{alias}` |
| `check_connection_pool` | ProxySQL 连接池详情 | `SELECT * FROM stats_mysql_connection_pool` |

### mysql-topology

触发方式：用户在 OpenClaw 中对话（例如"看一下拓扑"、"发现一个新实例"）。

handler.mjs 中的 6 个 tool 函数：

| Tool | 作用 | Orchestrator API |
|------|------|-----------------|
| `get_topology` | 完整拓扑树 | `GET /api/cluster/{alias}` |
| `get_instance_detail` | 单实例详情（UUID、GTID、semi-sync、uptime…） | `GET /api/instance/{host}/{port}` |
| `discover_instance` | 注册新实例到 Orchestrator | `GET /api/discover/{host}/{port}` |
| `relocate_instance` | 改变复制拓扑（挂到另一个父节点下） | `GET /api/relocate/{h}/{p}/{bh}/{bp}` |
| `begin_downtime` | 标记维护窗口（Orchestrator 跳过该实例） | `GET /api/begin-downtime/...` |
| `end_downtime` | 结束维护窗口 | `GET /api/end-downtime/{h}/{p}` |

### mysql-traffic

触发方式：用户在 OpenClaw 中对话（例如"查看路由"、"加一个 reader"）。

handler.mjs 中的 7 个 tool 函数：

| Tool | 作用 | ProxySQL SQL |
|------|------|-------------|
| `get_servers` | 当前所有 server 条目 | `SELECT * FROM mysql_servers` |
| `get_pool_stats` | 连接池实时统计 | `SELECT * FROM stats_mysql_connection_pool` |
| `get_query_rules` | 查询路由规则列表 | `SELECT * FROM mysql_query_rules` |
| `add_server` | 添加 server 到指定 hostgroup | `INSERT INTO mysql_servers ...` → LOAD+SAVE |
| `remove_server` | 移除 server（可指定 hostgroup） | `DELETE FROM mysql_servers ...` → LOAD+SAVE |
| `switch_writer` | 原子切换 writer | 同 mysql-failover 的 switch_writer |
| `set_server_status` | 改变 server 状态（ONLINE/OFFLINE_SOFT/OFFLINE_HARD） | `UPDATE mysql_servers SET status=...` → LOAD+SAVE |

---

## 共享客户端库

四个 Skill 的 handler 通过 `skills/lib/` 下的两个客户端库操作外部组件：

### orchestrator-client.mjs

通过 HTTP `fetch` 调用 Orchestrator REST API。环境变量 `ORCHESTRATOR_URL` 控制地址（默认 `http://orchestrator:3000`）。每次请求 10 秒超时（AbortController）。

导出 15 个函数：`getClusterInstances`, `getClusterInfo`, `getInstance`, `discoverInstance`, `getClusters`, `relocateInstance`, `setReadOnly`, `setWriteable`, `recover`, `forceMasterFailover`, `gracefulMasterTakeover`, `ackRecovery`, `beginDowntime`, `endDowntime`, `getTopology`（便捷封装）, `healthCheck`。

### proxysql-client.mjs

通过 `mysql2/promise` 连接 ProxySQL Admin 端口（6032）。环境变量 `PROXYSQL_HOST`, `PROXYSQL_PORT`, `PROXYSQL_USER`, `PROXYSQL_PASSWORD` 控制连接参数。连接池上限 3。

导出 15 个函数：`getServers`, `getWriters`, `getReaders`, `addServer`, `removeServer`, `setServerStatus`, `switchWriter`（4 步原子操作）, `getPoolStats`, `getActiveConnections`, `getQueryRules`, `loadServers`, `loadQueryRules`, `ping`, `destroy`。常量 `HG_WRITER=10`, `HG_READER=20`, `HG_BACKUP=30`。

关键实现——`switchWriter` 的 4 步原子切换：

```sql
-- 1. 从 writer 组移除旧主
DELETE FROM mysql_servers WHERE hostname='old' AND port=3306 AND hostgroup_id=10;
-- 2. 旧主降为 reader
REPLACE INTO mysql_servers (hostgroup_id,hostname,port,weight,max_connections) VALUES (20,'old',3306,1000,200);
-- 3. 从 reader 组移除新主
DELETE FROM mysql_servers WHERE hostname='new' AND port=3306 AND hostgroup_id=20;
-- 4. 新主升为 writer
REPLACE INTO mysql_servers (hostgroup_id,hostname,port,weight,max_connections) VALUES (10,'new',3306,1000,200);
-- 5. 生效 + 持久化
LOAD MYSQL SERVERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
```

---

## 基础设施配置

### MySQL 集群

| 参数 | Primary | Replica-1 | Replica-2 |
|------|---------|-----------|-----------|
| server_id | 100 | 201 | 202 (command 覆盖) |
| gtid_mode | ON | ON | ON |
| binlog_format | ROW | ROW | ROW |
| log_slave_updates | ON | ON | ON |
| read_only | 0 | 1 | 1 |
| super_read_only | 0 | 1 | 1 |
| report_host | mysql-primary | mysql-replica-1 | mysql-replica-2 (command 覆盖) |

复制方式：GTID auto-positioning（`MASTER_AUTO_POSITION=1`），replica 启动时自动 `CHANGE MASTER TO` + `START SLAVE`。

初始化用户（init-primary.sql 在 primary 上创建，replica 通过复制同步）：

| 用户 | 密码 | 权限 | 用途 |
|------|------|------|------|
| `repl` | `repl_pass` | REPLICATION SLAVE | GTID 复制 |
| `orchestrator` | `orch_pass` | SUPER, PROCESS, REPLICATION SLAVE/CLIENT, RELOAD, SELECT on mysql.slave_master_info | Orchestrator 拓扑发现 |
| `proxysql_mon` | `mon_pass` | REPLICATION CLIENT | ProxySQL monitor 模块 |
| `app` | `app_pass` | ALL PRIVILEGES | 应用连接 |

### Orchestrator

| 配置项 | 值 | 说明 |
|--------|---|------|
| InstancePollSeconds | 5 | 每 5 秒探测一次 MySQL 实例 |
| RecoveryPeriodBlockSeconds | 60 | 恢复冷却期 60 秒 |
| RecoverMasterClusterFilters | ["*"] | 允许所有集群自动恢复 |
| DiscoverByShowSlaveHosts | true | 通过 SHOW SLAVE HOSTS 自动发现 |
| MySQLHostnameResolveMethod | none | 容器环境下不做 hostname 反解 |
| 后端 DB | orchestrator-db:3306 | 独立 MySQL 实例存储 Orchestrator 元数据 |

Hooks 配置——Orchestrator 在恢复完成/失败后执行 curl：

```
PostFailoverProcesses:
  → POST http://openclaw:18789/hooks/agent
  → JSON body with Authorization header: Bearer clawsql-webhook-secret + skill, failureType, failedHost/Port, successorHost/Port, isSuccessful, isMaster 等

PostUnsuccessfulFailoverProcesses:
  → 同上，isSuccessful=false
```

### ProxySQL

| 配置项 | 值 |
|--------|---|
| Admin 端口 | 6032，用户 admin/admin_pass |
| MySQL 协议端口 | 6033，应用通过此端口连接 |
| Monitor 用户 | proxysql_mon/mon_pass |
| monitor_read_only_interval | 1500ms（检测 read_only 变化） |
| monitor_ping_interval | 10000ms |

Hostgroup 与 Server 初始配置：

| Hostgroup | 用途 | 初始成员 |
|-----------|------|---------|
| HG 10 (Writer) | 写入 + SELECT FOR UPDATE | mysql-primary:3306 |
| HG 20 (Reader) | 普通 SELECT | mysql-replica-1:3306, mysql-replica-2:3306 |
| HG 30 (Backup) | 预留 | 无 |

Query Rules：

| Rule ID | 匹配 | 目标 |
|---------|-------|------|
| 100 | `^SELECT .* FOR UPDATE$` | HG 10 (writer) |
| 200 | `^SELECT` | HG 20 (reader) |

Application 用户：`app/app_pass`，default_hostgroup=10（非 SELECT 走 writer）。

---

## Quick Start

```bash
git clone https://github.com/clawsql/clawsql.git
cd clawsql

# 1. 启动全部 7 个容器
bash scripts/setup.sh
#    等待 MySQL healthy → 验证复制 → 发现实例到 Orchestrator → 显示初始状态

# 2. 检查集群健康状态
bash scripts/check-cluster.sh

# 3. 演示故障转移（docker stop primary → 等待 30s → 查看结果）
bash scripts/demo-failover.sh

# 4. 清理（删除容器 + volumes）
bash scripts/teardown.sh
```

### 端口速查

| 端口 | 服务 | 用途 |
|------|------|------|
| 3307 | mysql-primary | MySQL 直连 |
| 3308 | mysql-replica-1 | MySQL 直连 |
| 3309 | mysql-replica-2 | MySQL 直连 |
| 3000 | orchestrator | Web UI + REST API |
| 6033 | proxysql | 应用 MySQL 入口（读写分离） |
| 6032 | proxysql | Admin SQL 接口 |
| 3100 | openclaw | OpenClaw UI |

---

## 项目结构

```
clawsql/
├── docker-compose.yml                 # 7 容器编排
├── config/
│   ├── mysql/
│   │   ├── primary.cnf                # sid=100, GTID, read_only=0
│   │   ├── replica.cnf                # sid=201, GTID, read_only=1
│   │   ├── init-primary.sql           # 4 个用户 + demo 库
│   │   └── init-replica.sql           # CHANGE MASTER TO + START SLAVE
│   ├── orchestrator/
│   │   └── orchestrator.conf.json     # poll 5s, hooks → OpenClaw
│   └── proxysql/
│       └── proxysql.cnf               # HG10/20, query rules, monitor
├── skills/
│   ├── package.json                   # 依赖：mysql2
│   ├── lib/
│   │   ├── orchestrator-client.mjs    # 15 个函数，fetch → Orchestrator REST
│   │   ├── proxysql-client.mjs        # 15 个函数，mysql2 → ProxySQL Admin SQL
│   │   └── utils.mjs                  # 格式化 + 工具函数
│   ├── mysql-failover/
│   │   ├── SKILL.md                   # webhook trigger, 3 条决策分支
│   │   └── handler.mjs               # 5 tools: switch_writer, verify_routing...
│   ├── mysql-health/
│   │   ├── SKILL.md                   # cron */5, CRITICAL/WARNING/HEALTHY 判定
│   │   └── handler.mjs               # 4 tools: check_replication, check_pool...
│   ├── mysql-topology/
│   │   ├── SKILL.md                   # chat trigger, 拓扑管理
│   │   └── handler.mjs               # 6 tools: discover, relocate, downtime...
│   ├── mysql-traffic/
│   │   ├── SKILL.md                   # chat trigger, 路由管理
│   │   └── handler.mjs               # 7 tools: add/remove server, switch...
│   └── mysql-demo/                    # NEW: Interactive demo skill
│       ├── SKILL.md                   # chat/webhook trigger, demo actions
│       └── handler.mjs               # 8 tools: health check, switchover...
├── scripts/
│   ├── setup.sh                       # 启动 + 等待 + 发现 + 验证
│   ├── demo-failover.sh               # kill primary → 观察恢复 → 检查路由
│   ├── check-cluster.sh               # 组件健康速查
│   ├── teardown.sh                    # docker compose down -v
│   ├── init-openclaw.sh               # 初始化 OpenClaw 配置
│   ├── demo-runner.sh                 # Interactive demo menu
│   └── demo-actions/                  # NEW: Demo action scripts
│       ├── demo-health-check.sh       # Health check with AI analysis
│       └── demo-switchover.sh         # Controlled switchover demo
├── .env.example
├── .gitignore
└── README.md
```
## RDS MySQL 兼容性

RDS MySQL 原生复制实例的高权限账号具有 `RESET SLAVE`、`CHANGE MASTER TO`、`SET GLOBAL read_only=0` 权限。这意味着 Orchestrator 可以直接管理 RDS 实例的复制拓扑和故障恢复，ClawSQL 的 Skill 体系无需任何修改即可应用于跨云/混合云的 RDS MySQL 集群。

## License

Apache License 2.0

---

## Troubleshooting

### Webhook Integration Issues

If the automatic failover via OpenClaw webhooks is not working:

1. **Check ANTHROPIC_API_KEY**: The webhook endpoint requires a valid Anthropic API key for AI processing. Set `ANTHROPIC_API_KEY` in your `.env` file or as an environment variable.

2. **Verify OpenClaw config**: Run `bash scripts/init-openclaw.sh` to generate the correct configuration, then restart containers.

3. **Check OpenClaw logs**: Run `docker logs clawsql-openclaw` and look for:
   - `listening on ws://0.0.0.0:18789` - Gateway is running
   - Webhook requests should appear in logs

4. **Manual failover**: If webhooks fail, manually update ProxySQL routing:
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

## Using Alibaba DashScope (Qwen Models) instead of Anthropic

ClawSQL supports using Alibaba's DashScope API with Qwen models as an alternative to Anthropic Claude.

### Option 1: Using DashScope API Key

1. Get your API key from [Alibaba Cloud Model Studio](https://help.aliyun.com/zh/model-studio/)

2. Set the environment variable before running setup:
   ```bash
   export DASHSCOPE_API_KEY=sk-your-key-here
   bash scripts/init-openclaw.sh
   bash scripts/setup.sh
   ```

3. Or create a `.env` file:
   ```bash
   cp .env.example .env
   # Edit .env and set DASHSCOPE_API_KEY=sk-...
   bash scripts/init-openclaw.sh
   bash scripts/setup.sh
   ```

### Option 2: Using Qwen OAuth (Free Tier - 2,000 requests/day)

```bash
# Enable the Qwen plugin inside OpenClaw
docker exec clawsql-openclaw openclaw plugins enable qwen-portal-auth

# Run OAuth authentication
docker exec clawsql-openclaw openclaw models auth login --provider qwen-portal --set-default

# Restart OpenClaw
docker restart clawsql-openclaw
```

### Available Qwen Models

| Model ID | Description | Context Window |
|----------|-------------|----------------|
| `dashscope/qwen-plus` | Balanced Qwen model | 131K tokens |
| `dashscope/qwen-max` | Most capable Qwen model | 32K tokens |
| `dashscope/qwen-coder-plus` | Code-optimized Qwen | 131K tokens |
| `qwen-portal/coder-model` | OAuth Qwen Coder | 2K requests/day |
| `qwen-portal/vision-model` | OAuth Qwen Vision | 2K requests/day |

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

You can interact with the OpenClaw AI agent via webhooks:

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
# Set your API key
echo "ANTHROPIC_API_KEY=sk-..." > .env

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
| 3100 | OpenClaw UI | http://localhost:3100 |

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
