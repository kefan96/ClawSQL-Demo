/**
 * Shared utilities for ClawSQL skills
 */

export function timestamp() {
  return new Date().toISOString();
}

export function hostPort(host, port) {
  return `${host}:${port}`;
}

/**
 * Format Orchestrator instances into a readable topology summary
 */
export function formatTopology(topo) {
  const lines = [];

  if (topo.primary) {
    const p = topo.primary;
    lines.push(`Primary: ${p.Key.Hostname}:${p.Key.Port} (server_id=${p.ServerID})`);
  } else {
    lines.push('Primary: NOT DETECTED');
  }

  for (const r of topo.replicas) {
    const lag = r.ReplicationLagSeconds?.Valid ? `${r.ReplicationLagSeconds.Int64}s` : '?';
    const sql = r.ReplicationSQLThreadRuning ? 'Y' : 'N';
    const io  = r.ReplicationIOThreadRuning  ? 'Y' : 'N';
    const problems = r.Problems?.length ? ` [${r.Problems.join(', ')}]` : '';
    lines.push(`  Replica: ${r.Key.Hostname}:${r.Key.Port} lag=${lag} SQL=${sql} IO=${io}${problems}`);
  }

  if (topo.problems.length > 0) {
    lines.push(`\nProblems: ${topo.problems.length} instance(s) with issues`);
  }

  return lines.join('\n');
}

/**
 * Format ProxySQL servers into a readable routing summary
 */
export function formatRouting(servers) {
  const writers = servers.filter(s => s.hostgroup_id === 10);
  const readers = servers.filter(s => s.hostgroup_id === 20);

  const lines = ['Writers (HG 10):'];
  for (const s of writers) {
    lines.push(`  ${s.hostname}:${s.port} status=${s.status} weight=${s.weight}`);
  }
  if (writers.length === 0) lines.push('  (none)');

  lines.push('Readers (HG 20):');
  for (const s of readers) {
    lines.push(`  ${s.hostname}:${s.port} status=${s.status} weight=${s.weight}`);
  }
  if (readers.length === 0) lines.push('  (none)');

  return lines.join('\n');
}

/**
 * Sleep utility
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
