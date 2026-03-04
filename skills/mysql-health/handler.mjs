/**
 * mysql-health skill — tool implementations
 *
 * Periodic health checks called by OpenClaw cron trigger.
 */

import * as proxy from '../lib/proxysql-client.mjs';
import * as orch  from '../lib/orchestrator-client.mjs';
import { timestamp } from '../lib/utils.mjs';

const CLUSTER_ALIAS = process.env.CLUSTER_ALIAS || 'clawsql-demo';

export const tools = {

  async check_orchestrator_health() {
    const reachable = await orch.healthCheck();
    return {
      component: 'orchestrator',
      reachable,
      timestamp: timestamp(),
    };
  },

  async check_proxysql_health() {
    const reachable = await proxy.ping();
    return {
      component: 'proxysql',
      reachable,
      timestamp: timestamp(),
    };
  },

  async check_replication_status() {
    const topo = await orch.getTopology(CLUSTER_ALIAS);

    const primary = topo.primary ? {
      host: topo.primary.Key.Hostname,
      port: topo.primary.Key.Port,
      serverId: topo.primary.ServerID,
      readOnly: topo.primary.ReadOnly,
    } : null;

    const replicas = topo.replicas.map(r => ({
      host: r.Key.Hostname,
      port: r.Key.Port,
      serverId: r.ServerID,
      lagSeconds: r.ReplicationLagSeconds?.Valid ? r.ReplicationLagSeconds.Int64 : null,
      sqlThreadRunning: r.ReplicationSQLThreadRuning,
      ioThreadRunning: r.ReplicationIOThreadRuning,
      readOnly: r.ReadOnly,
      gtidErrant: r.GtidErrant || '',
      problems: r.Problems || [],
    }));

    const problems = topo.problems.map(p => ({
      host: p.Key.Hostname,
      port: p.Key.Port,
      issues: p.Problems,
    }));

    return {
      primary,
      replicas,
      problems,
      totalInstances: topo.all.length,
      timestamp: timestamp(),
    };
  },

  async check_connection_pool() {
    const stats = await proxy.getPoolStats();

    const perServer = stats.map(s => ({
      hostgroup: s.hostgroup,
      host: s.srv_host,
      port: s.srv_port,
      status: s.status,
      connectionsUsed: s.ConnUsed,
      connectionsFree: s.ConnFree,
      connectionsError: s.ConnERR,
      queries: s.Queries,
      latencyMs: (s.Latency_us / 1000).toFixed(1),
    }));

    const totalUsed = stats.reduce((s, r) => s + r.ConnUsed, 0);
    const totalFree = stats.reduce((s, r) => s + r.ConnFree, 0);

    return {
      perServer,
      totalUsed,
      totalFree,
      usagePercent: totalUsed + totalFree > 0
        ? ((totalUsed / (totalUsed + totalFree)) * 100).toFixed(1)
        : '0.0',
      timestamp: timestamp(),
    };
  },
};
