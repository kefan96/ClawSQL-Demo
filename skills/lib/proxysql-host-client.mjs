/**
 * ProxySQL Admin Client - HTTP bridge to host
 *
 * Connects to the HTTP bridge running on the host
 * which provides access to ProxySQL admin functions.
 */

const BRIDGE_URL = process.env.PROXYSQL_BRIDGE_URL || 'http://host.containers.internal:9090';

async function httpGet(path) {
  const response = await fetch(`${BRIDGE_URL}${path}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function httpPost(path, body) {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export const HG_WRITER = 10;
export const HG_READER = 20;
export const HG_BACKUP = 30;

export async function getServers() {
  const data = await httpGet('/servers');
  return data.servers;
}

export async function switchWriter(oldHost, oldPort, newHost, newPort) {
  return httpPost('/switch-writer', { oldHost, newHost });
}

export async function removeServer(hostname, port) {
  return httpPost('/remove-server', { hostname, port });
}

export async function addServer(hostgroup, hostname, port, weight = 1000, maxConn = 200) {
  return httpPost('/add-server', { hostgroup, hostname, port, weight, maxConn });
}
