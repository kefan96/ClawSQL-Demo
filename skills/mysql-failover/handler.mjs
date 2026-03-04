/**
 * mysql-failover skill — tool implementations
 *
 * These functions are called by OpenClaw's AI when processing
 * an Orchestrator failover webhook.
 */

import * as proxy from '../lib/proxysql-client.mjs';
import * as orch  from '../lib/orchestrator-client.mjs';
import { formatTopology, formatRouting, timestamp } from '../lib/utils.mjs';

const CLUSTER_ALIAS = process.env.CLUSTER_ALIAS || 'clawsql-demo';

export const tools = {

  /**
   * Get all servers currently configured in ProxySQL
   */
  async get_proxysql_servers() {
    const servers = await proxy.getServers();
    return {
      servers,
      summary: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  /**
   * Atomic writer switch in ProxySQL
   */
  async switch_writer({ oldHost, oldPort, newHost, newPort }) {
    console.log(`[failover] Switching writer: ${oldHost}:${oldPort} → ${newHost}:${newPort}`);

    await proxy.switchWriter(oldHost, oldPort, newHost, newPort);

    const servers = await proxy.getServers();
    return {
      success: true,
      message: `Writer switched from ${oldHost}:${oldPort} to ${newHost}:${newPort}`,
      currentRouting: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  /**
   * Remove a failed server from all ProxySQL hostgroups
   */
  async remove_failed_server({ hostname, port }) {
    console.log(`[failover] Removing failed server: ${hostname}:${port}`);

    await proxy.removeServer(hostname, port);

    return {
      success: true,
      message: `Removed ${hostname}:${port} from all hostgroups`,
      timestamp: timestamp(),
    };
  },

  /**
   * Verify current routing is consistent
   */
  async verify_routing() {
    const servers = await proxy.getServers();
    const writers = servers.filter(s => s.hostgroup_id === 10 && s.status === 'ONLINE');
    const readers = servers.filter(s => s.hostgroup_id === 20 && s.status === 'ONLINE');

    const issues = [];
    if (writers.length === 0) issues.push('NO WRITER — cluster has no active writer!');
    if (writers.length > 1)   issues.push(`MULTI-WRITER — ${writers.length} writers detected`);
    if (readers.length === 0) issues.push('NO READERS — all read traffic goes to writer');

    return {
      writers: writers.map(s => `${s.hostname}:${s.port}`),
      readers: readers.map(s => `${s.hostname}:${s.port}`),
      issues,
      healthy: issues.length === 0,
      summary: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  /**
   * Get current topology from Orchestrator
   */
  async get_orchestrator_topology() {
    const topo = await orch.getTopology(CLUSTER_ALIAS);
    return {
      primary: topo.primary ? `${topo.primary.Key.Hostname}:${topo.primary.Key.Port}` : null,
      replicaCount: topo.replicas.length,
      problemCount: topo.problems.length,
      summary: formatTopology(topo),
      timestamp: timestamp(),
    };
  },
};
