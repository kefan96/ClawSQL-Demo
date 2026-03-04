/**
 * mysql-traffic skill — tool implementations
 *
 * ProxySQL traffic routing management.
 */

import * as proxy from '../lib/proxysql-client.mjs';
import { formatRouting, timestamp } from '../lib/utils.mjs';

export const tools = {

  async get_servers() {
    const servers = await proxy.getServers();
    return {
      servers: servers.map(s => ({
        hostgroup: s.hostgroup_id,
        hostname: s.hostname,
        port: s.port,
        status: s.status,
        weight: s.weight,
        maxConnections: s.max_connections,
      })),
      summary: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  async get_pool_stats() {
    const stats = await proxy.getPoolStats();
    return {
      stats: stats.map(s => ({
        hostgroup: s.hostgroup,
        host: s.srv_host,
        port: s.srv_port,
        status: s.status,
        connUsed: s.ConnUsed,
        connFree: s.ConnFree,
        queries: s.Queries,
        latencyMs: (s.Latency_us / 1000).toFixed(1),
      })),
      totalActiveConnections: await proxy.getActiveConnections(),
      timestamp: timestamp(),
    };
  },

  async get_query_rules() {
    const rules = await proxy.getQueryRules();
    return {
      rules: rules.map(r => ({
        ruleId: r.rule_id,
        active: !!r.active,
        matchDigest: r.match_digest,
        matchPattern: r.match_pattern,
        destinationHostgroup: r.destination_hostgroup,
        comment: r.comment,
      })),
      timestamp: timestamp(),
    };
  },

  async add_server({ hostgroup, hostname, port, weight = 1000 }) {
    await proxy.addServer(hostgroup, hostname, port, weight);
    const servers = await proxy.getServers();
    return {
      success: true,
      message: `Added ${hostname}:${port} to hostgroup ${hostgroup}`,
      currentRouting: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  async remove_server({ hostname, port, hostgroup = null }) {
    await proxy.removeServer(hostname, port, hostgroup);
    const servers = await proxy.getServers();
    return {
      success: true,
      message: `Removed ${hostname}:${port}` + (hostgroup ? ` from HG ${hostgroup}` : ' from all hostgroups'),
      currentRouting: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  async switch_writer({ oldHost, oldPort, newHost, newPort }) {
    await proxy.switchWriter(oldHost, oldPort, newHost, newPort);
    const servers = await proxy.getServers();
    return {
      success: true,
      message: `Writer switched: ${oldHost}:${oldPort} → ${newHost}:${newPort}`,
      currentRouting: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  async set_server_status({ hostname, port, hostgroup, status }) {
    await proxy.setServerStatus(hostname, port, hostgroup, status);
    return {
      success: true,
      message: `Set ${hostname}:${port} (HG ${hostgroup}) status to ${status}`,
      timestamp: timestamp(),
    };
  },
};
