#!/usr/bin/env bash
set -euo pipefail

# Initialize OpenClaw configuration for ClawSQL
# This script configures the hooks module to receive Orchestrator webhooks

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════╗"
echo "║     OpenClaw Initialization              ║"
echo "╚══════════════════════════════════════════╝"

# Create OpenClaw config directory if it doesn't exist
mkdir -p "$PROJECT_DIR/config/openclaw"

# Check which API key is available and generate appropriate config
if [[ -n "${DASHSCOPE_API_KEY:-}" ]]; then
    echo ""
    echo "Detected DASHSCOPE_API_KEY - configuring Qwen/DashScope provider"
    echo ""

    cat > "$PROJECT_DIR/config/openclaw/openclaw.json" << EOFCONFIG
{
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true,
    "ownerDisplay": "raw"
  },
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "clawsql-token"
    },
    "bind": "lan"
  },
  "models": {
    "providers": {
      "dashscope": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api": "openai-completions",
        "apiKey": "${DASHSCOPE_API_KEY}",
        "models": [
          {
            "id": "qwen-plus",
            "name": "Qwen Plus",
            "input": ["text"],
            "reasoning": false,
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 131072,
            "outputLimit": 16384
          },
          {
            "id": "qwen-max",
            "name": "Qwen Max",
            "input": ["text"],
            "reasoning": false,
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 32000,
            "outputLimit": 8192
          }
        ]
      }
    },
    "defaults": {
      "primary": "dashscope/qwen-plus"
    }
  },
  "hooks": {
    "enabled": true,
    "token": "clawsql-webhook-secret",
    "path": "/hooks",
    "maxBodyBytes": 262144,
    "defaultSessionKey": "hook:orchestrator",
    "allowRequestSessionKey": true,
    "allowedSessionKeyPrefixes": ["hook:"],
    "allowedAgentIds": ["main"],
    "mappings": [
      {
        "match": { "path": "agent" },
        "action": "agent",
        "agentId": "main",
        "wakeMode": "now",
        "deliver": true
      }
    ]
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "dashscope/qwen-plus"
      }
    }
  }
}
EOFCONFIG
elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo ""
    echo "Detected ANTHROPIC_API_KEY - configuring Anthropic provider"
    echo ""

    cat > "$PROJECT_DIR/config/openclaw/openclaw.json" << EOFCONFIG
{
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true,
    "ownerDisplay": "raw"
  },
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "clawsql-token"
    },
    "bind": "lan"
  },
  "hooks": {
    "enabled": true,
    "token": "clawsql-webhook-secret",
    "path": "/hooks",
    "maxBodyBytes": 262144,
    "defaultSessionKey": "hook:orchestrator",
    "allowRequestSessionKey": true,
    "allowedSessionKeyPrefixes": ["hook:"],
    "allowedAgentIds": ["main"],
    "mappings": [
      {
        "match": { "path": "agent" },
        "action": "agent",
        "agentId": "main",
        "wakeMode": "now",
        "deliver": true
      }
    ]
  }
}
EOFCONFIG
else
    echo ""
    echo "WARNING: No API key detected (neither ANTHROPIC_API_KEY nor DASHSCOPE_API_KEY)"
    echo "The webhook will be received but AI processing will fail."
    echo ""
    echo "To enable AI processing, set one of these environment variables:"
    echo "  - ANTHROPIC_API_KEY=sk-ant-...  (for Claude models)"
    echo "  - DASHSCOPE_API_KEY=sk-...      (for Qwen models via Alibaba DashScope)"
    echo ""
    echo "Get your DashScope API key from: https://help.aliyun.com/zh/model-studio/"
    echo ""

    cat > "$PROJECT_DIR/config/openclaw/openclaw.json" << 'EOFCONFIG'
{
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true,
    "ownerDisplay": "raw"
  },
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "clawsql-token"
    },
    "bind": "lan"
  },
  "hooks": {
    "enabled": true,
    "token": "clawsql-webhook-secret",
    "path": "/hooks",
    "maxBodyBytes": 262144,
    "defaultSessionKey": "hook:orchestrator",
    "allowRequestSessionKey": true,
    "allowedSessionKeyPrefixes": ["hook:"],
    "allowedAgentIds": ["main"],
    "mappings": [
      {
        "match": { "path": "agent" },
        "action": "agent",
        "agentId": "main",
        "wakeMode": "now",
        "deliver": true
      }
    ]
  }
}
EOFCONFIG
fi

echo "Configuration written to $PROJECT_DIR/config/openclaw/openclaw.json"
echo ""
echo "To apply this configuration:"
echo "  1. Run 'bash scripts/setup.sh' to start containers"
echo "  2. Or restart the OpenClaw container if already running"
echo ""
