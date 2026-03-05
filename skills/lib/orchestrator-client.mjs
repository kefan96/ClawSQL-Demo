/**
 * Orchestrator REST API Client
 *
 * Lightweight client for OpenClaw skills to call Orchestrator.
 * All functions return plain objects, no class instances.
 */

const ORCH_BASE = process.env.ORCHESTRATOR_URL || 'http://orchestrator:3000';
const TIMEOUT   = 10_000;

async function orch(path, method = 'GET', body = null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const res = await fetch(`${ORCH_BASE}${path}`, options);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`Orchestrator ${method} ${path} → ${res.status}: ${bodyText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Topology ───

export async function getClusterInstances(alias) {
  return orch(`/api/cluster/${encodeURIComponent(alias)}`);
}

export async function getClusterInfo(alias) {
  return orch(`/api/cluster/info/${encodeURIComponent(alias)}`);
}

export async function getInstance(host, port) {
  return orch(`/api/instance/${host}/${port}`);
}

export async function discoverInstance(host, port) {
  return orch(`/api/discover/${host}/${port}`);
}

export async function getClusters() {
  return orch('/api/clusters');
}

// ─── Topology manipulation ───

export async function relocateInstance(host, port, belowHost, belowPort) {
  return orch(`/api/relocate/${host}/${port}/${belowHost}/${belowPort}`);
}

export async function setReadOnly(host, port) {
  return orch(`/api/set-read-only/${host}/${port}`);
}

export async function setWriteable(host, port) {
  return orch(`/api/set-writeable/${host}/${port}`);
}

// ─── Recovery ───

export async function recover(alias) {
  return orch(`/api/recover/${encodeURIComponent(alias)}`);
}

export async function forceMasterFailover(alias) {
  return orch(`/api/force-master-failover/${encodeURIComponent(alias)}`);
}

export async function gracefulMasterTakeover(alias, target = {}) {
  // Support object-style arguments for auto takeover
  if (typeof target === 'object') {
    const { targetHost, targetPort } = target;
    return orch(`/api/graceful-master-takeover-auto/${encodeURIComponent(alias)}`, 'POST', {
      targetHost,
      targetPort,
    });
  }
  return orch(`/api/graceful-master-takeover/${encodeURIComponent(alias)}/${target}`);
}

export async function ackRecovery(uid, comment) {
  return orch(`/api/ack-recovery/${uid}?comment=${encodeURIComponent(comment)}`);
}

// ─── Downtime ───

export async function beginDowntime(host, port, owner, reason, seconds) {
  return orch(`/api/begin-downtime/${host}/${port}/${encodeURIComponent(owner)}/${encodeURIComponent(reason)}/${seconds}`);
}

export async function endDowntime(host, port) {
  return orch(`/api/end-downtime/${host}/${port}`);
}

// ─── Convenience ───

export async function getTopology(alias) {
  const instances = await getClusterInstances(alias);
  const primary = instances.find(i => !i.ReadOnly && (i.MasterKey.Hostname === '' || i.Replicas.length > 0))
               || instances.find(i => !i.ReadOnly);
  const replicas = instances.filter(i => i !== primary);
  const problems = instances.filter(i => i.Problems && i.Problems.length > 0);
  return { primary, replicas, problems, all: instances };
}

export async function healthCheck() {
  try {
    await orch('/api/health');
    return true;
  } catch {
    return false;
  }
}
