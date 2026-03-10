#!/usr/bin/env bash
set -euo pipefail

# ─── ClawSQL Setup Script ───
# Starts all containers, configures replication, and waits for ready state.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Container runtime (podman or docker)
RUNTIME="podman"
if ! command -v podman &>/dev/null; then
  RUNTIME="docker"
fi

echo "╔══════════════════════════════════════════╗"
echo "║        ClawSQL — Setup                   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Using runtime: $RUNTIME"
echo ""

# Step 1: Start containers
echo "▶ Starting containers..."
if $RUNTIME compose ps --quiet 2>/dev/null | grep -q .; then
  echo "  Refreshing existing containers..."
  $RUNTIME compose down --remove-orphans 2>/dev/null || true
fi
$RUNTIME compose up -d --remove-orphans
echo ""

# Step 2: Wait for MySQL primary
echo "▶ Waiting for MySQL primary..."
until $RUNTIME exec clawsql-primary mysqladmin ping -h127.0.0.1 -P3306 -uroot -proot_pass --silent 2>/dev/null; do
  sleep 2
done
echo "  ✓ MySQL primary ready"

# Step 3: Wait for replicas
echo "▶ Waiting for replicas..."
for replica in clawsql-replica-1 clawsql-replica-2; do
  until $RUNTIME exec "$replica" mysqladmin ping -h127.0.0.1 -P3306 -uroot -proot_pass --silent 2>/dev/null; do
    sleep 2
  done
  echo "  ✓ $replica ready"
done

# Step 4: Configure replication
echo "▶ Configuring replication..."
$RUNTIME exec clawsql-primary mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl_pass';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;
"

for replica in clawsql-replica-1 clawsql-replica-2; do
  $RUNTIME exec "$replica" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "
STOP SLAVE; RESET SLAVE ALL;
CHANGE MASTER TO
  MASTER_HOST='mysql-primary',
  MASTER_PORT=3306,
  MASTER_USER='repl',
  MASTER_PASSWORD='repl_pass',
  MASTER_AUTO_POSITION=1;
START SLAVE;
"
  echo "  ✓ $replica replication configured"
done

sleep 3
echo ""
echo "▶ Replication status:"
for replica in clawsql-replica-1 clawsql-replica-2; do
  io=$($RUNTIME exec "$replica" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_IO_Running:" | awk '{print $2}')
  sql=$($RUNTIME exec "$replica" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Slave_SQL_Running:" | awk '{print $2}')
  lag=$($RUNTIME exec "$replica" mysql -h127.0.0.1 -P3306 -uroot -proot_pass -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep "Seconds_Behind_Master:" | awk '{print $2}')
  echo "  $replica: IO=$io SQL=$sql Lag=${lag}s"
done

# Step 5: Wait for Orchestrator
echo ""
echo "▶ Waiting for Orchestrator..."
until curl -sf http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 3
done
echo "  ✓ Orchestrator ready"

# Step 6: Discover instances
echo "▶ Discovering instances in Orchestrator..."
curl -sf "http://localhost:3000/api/discover/mysql-primary/3306" > /dev/null 2>&1 || true
sleep 2
curl -sf "http://localhost:3000/api/discover/mysql-replica-1/3306" > /dev/null 2>&1 || true
curl -sf "http://localhost:3000/api/discover/mysql-replica-2/3306" > /dev/null 2>&1 || true
sleep 8

# Step 7: Configure ProxySQL
echo "▶ Configuring ProxySQL..."
$RUNTIME exec clawsql-proxysql mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -e "
INSERT OR REPLACE INTO mysql_users (username,password,default_hostgroup,active) VALUES ('root','root_pass',10,1);
INSERT OR REPLACE INTO mysql_users (username,password,default_hostgroup,active) VALUES ('app','app_pass',10,1);
LOAD MYSQL USERS TO RUNTIME;
SAVE MYSQL USERS TO DISK;
"
echo "  ✓ ProxySQL users configured"

# Step 8: Initialize OpenClaw config
echo "▶ Initializing OpenClaw configuration..."
mkdir -p "$PROJECT_DIR/config/openclaw"
if [[ -n "${DASHSCOPE_API_KEY:-}" ]]; then
  cat > "$PROJECT_DIR/config/openclaw/openclaw.json" << EOF
{
  "commands": {"native": "auto", "nativeSkills": "auto", "restart": true, "ownerDisplay": "raw"},
  "gateway": {"mode": "local", "bind": "lan", "port": 18789, "auth": {"mode": "token", "token": "clawsql-token"}, "controlUi": {"allowedOrigins": ["http://localhost:18789", "http://127.0.0.1:18789"]}},
  "models": {
    "providers": {
      "dashscope": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api": "openai-completions",
        "apiKey": "${DASHSCOPE_API_KEY}",
        "models": [{"id": "qwen-plus", "name": "Qwen Plus", "input": ["text"], "reasoning": false}]
      }
    }
  },
  "hooks": {
    "enabled": true, "token": "clawsql-webhook-secret", "path": "/hooks",
    "maxBodyBytes": 262144, "defaultSessionKey": "hook:orchestrator",
    "allowRequestSessionKey": true, "allowedSessionKeyPrefixes": ["hook:"],
    "allowedAgentIds": ["main"],
    "mappings": [{"match": {"path": "agent"}, "action": "agent", "agentId": "main", "wakeMode": "now", "deliver": true}]
  }
}
EOF
  echo "  ✓ OpenClaw config created (DashScope)"
elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  cat > "$PROJECT_DIR/config/openclaw/openclaw.json" << EOF
{
  "commands": {"native": "auto", "nativeSkills": "auto", "restart": true, "ownerDisplay": "raw"},
  "gateway": {"mode": "local", "bind": "lan", "port": 18789, "auth": {"mode": "token", "token": "clawsql-token"}, "controlUi": {"allowedOrigins": ["http://localhost:18789", "http://127.0.0.1:18789"]}},
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "models": [{"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "input": ["text"], "reasoning": false}]
      }
    }
  },
  "hooks": {
    "enabled": true, "token": "clawsql-webhook-secret", "path": "/hooks",
    "maxBodyBytes": 262144, "defaultSessionKey": "hook:orchestrator",
    "allowRequestSessionKey": true, "allowedSessionKeyPrefixes": ["hook:"],
    "allowedAgentIds": ["main"],
    "mappings": [{"match": {"path": "agent"}, "action": "agent", "agentId": "main", "wakeMode": "now", "deliver": true}]
  }
}
EOF
  echo "  ✓ OpenClaw config created (Anthropic)"
else
  echo "  ⚠ No API key found - create config/openclaw/openclaw.json manually"
fi

# Step 9: Start ProxySQL HTTP Bridge
echo ""
echo "▶ Starting ProxySQL HTTP Bridge..."
# Kill any existing bridge process
pkill -f proxysql-http-bridge 2>/dev/null || true
sleep 1
# Start the bridge in background
node "$PROJECT_DIR/scripts/proxysql-http-bridge.mjs" &
BRIDGE_PID=$!
sleep 2
# Verify bridge is running
if curl -sf http://localhost:9090/servers > /dev/null 2>&1; then
  echo "  ✓ ProxySQL HTTP Bridge running (PID: $BRIDGE_PID)"
else
  echo "  ⚠ ProxySQL HTTP Bridge failed to start"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║            Setup Complete!               ║"
echo "╠══════════════════════════════════════════╣"
echo "║  MySQL Primary:  localhost:3307           ║"
echo "║  Replica 1:      localhost:3308           ║"
echo "║  Replica 2:      localhost:3309           ║"
echo "║  ProxySQL:       localhost:6033 (mysql)   ║"
echo "║  ProxySQL Admin: localhost:6032           ║"
echo "║  Orchestrator:   http://localhost:3000    ║"
echo "║  OpenClaw:       http://localhost:18789    ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Run: bash scripts/check.sh              ║"
echo "║  Demo: bash scripts/demo.sh              ║"
echo "╚══════════════════════════════════════════╝"
