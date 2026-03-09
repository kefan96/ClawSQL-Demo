/**
 * ProxySQL HTTP Bridge
 * Runs on the host and provides HTTP API for ProxySQL admin operations
 *
 * Uses Podman exec to run SQL commands via mysql client (more reliable than SQLite)
 */

import { createServer } from 'http';
import { execSync } from 'child_process';

const CONTAINER = 'clawsql-proxysql';
const MYSQL_CMD = 'mysql -h127.0.0.1 -P6032 -uadmin -padmin_pass -N -B';
const ORCH_URL = process.env.ORCH_URL || 'http://localhost:3000';

const HG_WRITER = 10;
const HG_READER = 20;

function escapeValue(value) {
  // Escape single quotes in data values only
  return String(value).replace(/'/g, "''");
}

function execSql(sql) {
  try {
    const output = execSync(`podman exec ${CONTAINER} ${MYSQL_CMD} -e "${sql}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim();
  } catch (e) {
    throw new Error(`SQL execution failed: ${e.stderr || e.message}`);
  }
}

function loadServersToRuntime() {
  execSql('LOAD MYSQL SERVERS TO RUNTIME');
  execSql('SAVE MYSQL SERVERS TO DISK');
}

function getServers() {
  const output = execSql('SELECT hostgroup_id, hostname, port, status, weight FROM mysql_servers ORDER BY hostgroup_id, hostname');
  if (!output) return [];
  return output.split('\n').filter(l => l.trim()).map(line => {
    const parts = line.split(/\t+/);
    return {
      hostgroup_id: parseInt(parts[0]),
      hostname: parts[1],
      port: parseInt(parts[2]),
      status: parts[3],
      weight: parseInt(parts[4]) || 1000
    };
  });
}

function switchWriter(oldHost, newHost) {
  const old = escapeValue(oldHost);
  const neu = escapeValue(newHost);
  // Step 1: Remove old writer from HG_WRITER
  execSql(`DELETE FROM mysql_servers WHERE hostname='${old}' AND port=3306 AND hostgroup_id=${HG_WRITER}`);
  // Step 2: Add old writer to HG_READER
  execSql(`REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections) VALUES (${HG_READER}, '${old}', 3306, 1000, 200)`);
  // Step 3: Remove new writer from HG_READER
  execSql(`DELETE FROM mysql_servers WHERE hostname='${neu}' AND port=3306 AND hostgroup_id=${HG_READER}`);
  // Step 4: Add new writer to HG_WRITER
  execSql(`REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections) VALUES (${HG_WRITER}, '${neu}', 3306, 1000, 200)`);
  // Load to runtime and save
  loadServersToRuntime();
  return { success: true, message: `Switched writer from ${oldHost} to ${newHost}` };
}

function removeServer(hostname, port) {
  const host = escapeValue(hostname);
  execSql(`DELETE FROM mysql_servers WHERE hostname='${host}' AND port=${port}`);
  loadServersToRuntime();
  return { success: true, message: `Removed ${hostname}:${port}` };
}

function addServer(hostgroup, hostname, port, weight = 1000, maxConn = 200) {
  const host = escapeValue(hostname);
  execSql(`REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections) VALUES (${hostgroup}, '${host}', ${port}, ${weight}, ${maxConn})`);
  loadServersToRuntime();
  return { success: true, message: `Added ${hostname}:${port} to hostgroup ${hostgroup}` };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function syncWithOrchestrator() {
  // Get clusters from Orchestrator
  const clusters = await fetchJson(`${ORCH_URL}/api/clusters`);
  if (!clusters || clusters.length === 0) {
    return { success: false, message: 'No clusters found in Orchestrator' };
  }

  // Get cluster alias (find writable primary)
  let clusterAlias = null;
  for (const cluster of clusters) {
    try {
      const topology = await fetchJson(`${ORCH_URL}/api/cluster/${cluster}`);
      const writable = topology.find(i => !i.ReadOnly);
      if (writable) {
        clusterAlias = cluster;
        break;
      }
    } catch (e) {
      continue;
    }
  }
  if (!clusterAlias) {
    clusterAlias = clusters[0];
  }

  // Get topology
  const topology = await fetchJson(`${ORCH_URL}/api/cluster/${clusterAlias}`);
  const primary = topology.find(i => !i.ReadOnly);
  const replicas = topology.filter(i => i.ReadOnly);

  if (!primary) {
    return { success: false, message: 'No writable primary found in Orchestrator' };
  }

  const primaryHost = primary.Key.Hostname;
  const results = {
    primary: primaryHost,
    replicas: replicas.map(r => r.Key.Hostname),
    actions: []
  };

  // Get current writer from ProxySQL
  const servers = getServers();
  const currentWriter = servers.find(s => s.hostgroup_id === HG_WRITER);

  // Switch writer if needed
  if (currentWriter && currentWriter.hostname !== primaryHost) {
    switchWriter(currentWriter.hostname, primaryHost);
    results.actions.push(`Switched writer: ${currentWriter.hostname} -> ${primaryHost}`);
  } else if (!currentWriter) {
    addServer(HG_WRITER, primaryHost, 3306);
    results.actions.push(`Added ${primaryHost} as writer`);
  }

  // Ensure all replicas are in reader hostgroup
  for (const replica of replicas) {
    addServer(HG_READER, replica.Key.Hostname, 3306);
    results.actions.push(`Added ${replica.Key.Hostname} as reader`);
  }

  return { success: true, ...results };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  try {
    switch (url.pathname) {
      case '/servers':
        if (req.method !== 'GET') throw new Error('Method not allowed');
        const servers = getServers();
        res.writeHead(200);
        res.end(JSON.stringify({ servers }));
        break;
        
      case '/switch-writer':
        if (req.method !== 'POST') throw new Error('Method not allowed');
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const { oldHost, newHost } = JSON.parse(body);
          const result = switchWriter(oldHost, newHost);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        });
        break;

      case '/remove-server':
        if (req.method !== 'POST') throw new Error('Method not allowed');
        let body2 = '';
        req.on('data', chunk => body2 += chunk);
        req.on('end', () => {
          const { hostname, port } = JSON.parse(body2);
          const result = removeServer(hostname, port);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        });
        break;

      case '/add-server':
        if (req.method !== 'POST') throw new Error('Method not allowed');
        let body3 = '';
        req.on('data', chunk => body3 += chunk);
        req.on('end', () => {
          const { hostgroup, hostname, port, weight, maxConn } = JSON.parse(body3);
          const result = addServer(hostgroup, hostname, port, weight, maxConn);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        });
        break;

      case '/sync-topology':
        if (req.method !== 'POST') throw new Error('Method not allowed');
        syncWithOrchestrator()
          .then(result => {
            res.writeHead(200);
            res.end(JSON.stringify(result));
          })
          .catch(e => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          });
        break;

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
});

const PORT = process.env.BRIDGE_PORT || 9090;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ProxySQL bridge listening on port ${PORT}`);
});
