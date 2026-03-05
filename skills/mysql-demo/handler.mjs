/**
 * mysql-demo skill — interactive demo actions
 *
 * Provides tools for demonstrating ClawSQL cluster capabilities
 * including switchover, health checks, and topology visualization.
 */

import * as orch from '../lib/orchestrator-client.mjs';
import * as proxy from '../lib/proxysql-client.mjs';
import { formatTopology, formatRouting, timestamp } from '../lib/utils.mjs';

const CLUSTER_ALIAS = process.env.CLUSTER_ALIAS || 'clawsql-demo';

export const tools = {

  /**
   * Get comprehensive health status
   */
  async check_cluster_health() {
    const topology = await orch.getTopology(CLUSTER_ALIAS);
    const problems = topology.problems || [];

    const replicaStatus = topology.replicas.map(r => ({
      host: r.Key.Hostname,
      port: r.Key.Port,
      ioRunning: r.ReplicationIOThreadRuning,
      sqlRunning: r.ReplicationSQLThreadRuning,
      lagSeconds: r.ReplicationLagSeconds?.Valid ? r.ReplicationLagSeconds.Int64 : null,
      hasProblems: r.Problems?.length > 0,
      problems: r.Problems || [],
    }));

    const hasIssues = problems.length > 0 ||
      replicaStatus.some(r => !r.ioRunning || !r.sqlRunning || r.lagSeconds > 10);

    return {
      status: hasIssues ? 'WARNING' : 'HEALTHY',
      primary: topology.primary ? {
        host: topology.primary.Key.Hostname,
        port: topology.primary.Key.Port,
        serverId: topology.primary.ServerID,
      } : null,
      replicas: replicaStatus,
      problems: problems.map(p => ({
        host: p.Key.Hostname,
        port: p.Key.Port,
        issues: p.Problems,
      })),
      timestamp: timestamp(),
    };
  },

  /**
   * Get topology summary
   */
  async get_topology_summary() {
    const topology = await orch.getTopology(CLUSTER_ALIAS);
    return {
      clusterAlias: CLUSTER_ALIAS,
      primary: topology.primary ? {
        host: topology.primary.Key.Hostname,
        port: topology.primary.Key.Port,
        version: topology.primary.Version,
        gtidMode: topology.primary.GTIDMode,
        replicaCount: topology.primary.Replicas?.length || 0,
      } : null,
      replicas: topology.replicas.map(r => ({
        host: r.Key.Hostname,
        port: r.Key.Port,
        lagSeconds: r.ReplicationLagSeconds?.Valid ? r.ReplicationLagSeconds.Int64 : null,
        ioThread: r.ReplicationIOThreadRuning,
        sqlThread: r.ReplicationSQLThreadRuning,
        readOnly: r.ReadOnly,
      })),
      summary: formatTopology(topology),
      timestamp: timestamp(),
    };
  },

  /**
   * Get current writer from ProxySQL
   */
  async get_current_writer() {
    const servers = await proxy.getServers();
    const writers = servers.filter(s => s.hostgroup_id === 10);
    return {
      writers: writers.map(w => ({
        host: w.hostname,
        port: w.port,
        status: w.status,
      })),
      currentWriter: writers.length > 0 ? writers[0] : null,
      timestamp: timestamp(),
    };
  },

  /**
   * Get ProxySQL routing configuration
   */
  async get_proxysql_routing() {
    const servers = await proxy.getServers();
    return {
      writers: servers
        .filter(s => s.hostgroup_id === 10)
        .map(s => ({ host: s.hostname, port: s.port, status: s.status })),
      readers: servers
        .filter(s => s.hostgroup_id === 20)
        .map(s => ({ host: s.hostname, port: s.port, status: s.status })),
      summary: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  /**
   * Check if replication is healthy for switchover
   */
  async check_replication_health() {
    const topology = await orch.getTopology(CLUSTER_ALIAS);

    if (!topology.primary) {
      return {
        healthy: false,
        reason: 'No primary found in cluster',
      };
    }

    const replicas = topology.replicas.map(r => ({
      host: r.Key.Hostname,
      healthy: r.ReplicationIOThreadRuning && r.ReplicationSQLThreadRuning,
      lagSeconds: r.ReplicationLagSeconds?.Valid ? r.ReplicationLagSeconds.Int64 : null,
      readyForPromotion: r.ReplicationIOThreadRuning &&
                         r.ReplicationSQLThreadRuning &&
                         (r.ReplicationLagSeconds?.Int64 ?? 999) < 5,
    }));

    const readyReplicas = replicas.filter(r => r.readyForPromotion);

    return {
      healthy: readyReplicas.length > 0,
      totalReplicas: replicas.length,
      readyReplicas: readyReplicas.length,
      replicas,
      recommendation: readyReplicas.length > 0
        ? `Ready for switchover. Candidates: ${readyReplicas.map(r => r.host).join(', ')}`
        : 'No replicas ready for promotion',
      timestamp: timestamp(),
    };
  },

  /**
   * Promote a replica to primary using Orchestrator
   */
  async promote_replica({ replicaHost, replicaPort = 3306 }) {
    // Use Orchestrator's graceful takeover API
    const result = await orch.gracefulMasterTakeover(CLUSTER_ALIAS, {
      targetHost: replicaHost,
      targetPort: replicaPort,
    });

    return {
      success: result.Code === 'OK',
      message: result.Message,
      newPrimary: {
        host: replicaHost,
        port: replicaPort,
      },
      timestamp: timestamp(),
    };
  },

  /**
   * Update ProxySQL routing after switchover
   */
  async update_proxysql_routing({ oldWriter, newWriter, port = 3306 }) {
    // Move old writer to reader group
    await proxy.updateServerHostgroup(oldWriter, port, 10, 20);

    // Move new writer to writer group
    await proxy.updateServerHostgroup(newWriter, port, 20, 10);

    const servers = await proxy.getServers();

    return {
      success: true,
      message: `Routing updated: ${oldWriter} → reader, ${newWriter} → writer`,
      routing: formatRouting(servers),
      timestamp: timestamp(),
    };
  },

  /**
   * Verify switchover completed successfully
   */
  async verify_switchover({ expectedWriter }) {
    const topology = await orch.getTopology(CLUSTER_ALIAS);
    const servers = await proxy.getServers();

    const actualPrimary = topology.primary?.Key.Hostname;
    const proxysqlWriters = servers
      .filter(s => s.hostgroup_id === 10 && s.status === 'ONLINE')
      .map(s => s.hostname);

    const issues = [];

    if (actualPrimary !== expectedWriter) {
      issues.push(`Orchestrator primary (${actualPrimary}) doesn't match expected (${expectedWriter})`);
    }

    if (!proxysqlWriters.includes(expectedWriter)) {
      issues.push(`ProxySQL writer doesn't match expected: ${expectedWriter}`);
    }

    if (proxysqlWriters.length !== 1) {
      issues.push(`Expected 1 writer, found ${proxysqlWriters.length}`);
    }

    return {
      success: issues.length === 0,
      actualPrimary,
      proxysqlWriters,
      issues,
      healthy: issues.length === 0,
      timestamp: timestamp(),
    };
  },

  /**
   * Simulate a replica failure
   */
  async simulate_replica_failure({ replicaHost, replicaPort = 3306 }) {
    // In a real scenario, this would stop the replica
    // For demo, we just report what would happen
    const topology = await orch.getTopology(CLUSTER_ALIAS);

    const affectedReaders = topology.replicas.filter(r =>
      r.Key.Hostname === replicaHost
    ).length;

    const remainingReplicas = topology.replicas.filter(r =>
      r.Key.Hostname !== replicaHost
    );

    return {
      simulated: true,
      failedReplica: {
        host: replicaHost,
        port: replicaPort,
      },
      impact: {
        readersLost: 1,
        readersRemaining: remainingReplicas.length,
        writeCapabilityUnaffected: true,
      },
      remainingReplicas: remainingReplicas.map(r => r.Key.Hostname),
      orchwWouldDetect: true,
      automaticFailover: 'Not applicable for replica failure',
      recommendation: 'ProxySQL would automatically remove failed replica from rotation',
      timestamp: timestamp(),
    };
  },

  /**
   * Send webhook notification to OpenClaw
   */
  async send_webhook_notification({ action, details = {} }) {
    // This would be called by the AI to notify about actions
    // The actual webhook sending happens via HTTP POST to /hooks/agent
    return {
      notificationPrepared: true,
      action,
      details,
      webhookEndpoint: '/hooks/agent',
      message: `Webhook notification prepared for action: ${action}`,
      timestamp: timestamp(),
    };
  },
};
