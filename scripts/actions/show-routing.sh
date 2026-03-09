#!/usr/bin/env bash
set -euo pipefail

# ─── Action: Show ProxySQL Routing ───
# Displays current ProxySQL server routing configuration

echo ""
echo "▶ ProxySQL Routing:"

routing=$(curl -sf http://localhost:9090/servers 2>/dev/null)
if [ -n "$routing" ]; then
  echo "$routing" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
for s in data.get('servers', []):
    hg = 'WRITER' if s['hostgroup_id'] == 10 else 'READER'
    print(f\"  [{hg}] {s['hostname']}:{s['port']} ({s['status']})\")
" 2>/dev/null || echo "  (unable to parse routing)"
else
  echo "  (unavailable - is HTTP bridge running?)"
  echo "  Start with: node scripts/proxysql-http-bridge.mjs"
fi
echo ""
