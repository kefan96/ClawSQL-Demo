/**
 * mysql-topology skill — tool implementations
 *
 * Topology viewing and manipulation via Orchestrator REST API.
 */

import * as orch from '../lib/orchestrator-client.mjs';
import { formatTopology, timestamp } from '../lib/utils.mjs';

const CLUSTER_ALIAS = process.env.CLUSTER_ALIAS || 'clawsql-demo';

export const tools = {

  async get_topology() {
    const topo = await orch.getTopology(CLUSTER_ALIAS);
    return {
      primary: topo.primary ? {
        host: topo.primary.Key.Hostname,
        port: topo.primary.Key.Port,
        serverId: topo.primary.ServerID,
        version: topo.primary.Version,
        gtidMode: topo.primary.GTIDMode,
        semiSync: topo.primary.SemiSyncPrimaryStatus,
        replicaCount: topo.primary.Replicas?.length || 0,
      } : null,
      replicas: topo.replicas.map(r => ({
        host: r.Key.Hostname,
        port: r.Key.Port,
        serverId: r.ServerID,
        lagSeconds: r.ReplicationLagSeconds?.Valid ? r.ReplicationLagSeconds.Int64 : null,
        sqlThread: r.ReplicationSQLThreadRuning,
        ioThread: r.ReplicationIOThreadRuning,
        readOnly: r.ReadOnly,
        problems: r.Problems || [],
      })),
      problems: topo.problems.map(p => ({
        host: p.Key.Hostname,
        port: p.Key.Port,
        issues: p.Problems,
      })),
      summary: formatTopology(topo),
      timestamp: timestamp(),
    };
  },

  async get_instance_detail({ host, port }) {
    const instance = await orch.getInstance(host, port);
    return {
      host: instance.Key.Hostname,
      port: instance.Key.Port,
      serverId: instance.ServerID,
      serverUUID: instance.ServerUUID,
      version: instance.Version,
      readOnly: instance.ReadOnly,
      gtidMode: instance.GTIDMode,
      executedGtidSet: instance.ExecutedGtidSet,
      binlogFormat: instance.Binlog_format,
      semiSyncPrimary: instance.SemiSyncPrimaryEnabled,
      semiSyncReplica: instance.SemiSyncReplicaEnabled,
      masterHost: instance.MasterKey.Hostname,
      masterPort: instance.MasterKey.Port,
      lagSeconds: instance.ReplicationLagSeconds?.Valid ? instance.ReplicationLagSeconds.Int64 : null,
      sqlThread: instance.ReplicationSQLThreadRuning,
      ioThread: instance.ReplicationIOThreadRuning,
      lastSQLError: instance.LastSQLError,
      lastIOError: instance.LastIOError,
      uptime: instance.Uptime,
      problems: instance.Problems,
      isDowntimed: instance.IsDowntimed,
      downtimeReason: instance.DowntimeReason,
      dataCenter: instance.DataCenter,
      timestamp: timestamp(),
    };
  },

  async discover_instance({ host, port }) {
    const instance = await orch.discoverInstance(host, port);
    return {
      success: true,
      host: instance.Key.Hostname,
      port: instance.Key.Port,
      serverId: instance.ServerID,
      message: `Discovered ${host}:${port} (server_id=${instance.ServerID})`,
      timestamp: timestamp(),
    };
  },

  async relocate_instance({ host, port, belowHost, belowPort }) {
    const instance = await orch.relocateInstance(host, port, belowHost, belowPort);
    return {
      success: true,
      message: `Moved ${host}:${port} to replicate from ${belowHost}:${belowPort}`,
      newMaster: `${instance.MasterKey.Hostname}:${instance.MasterKey.Port}`,
      timestamp: timestamp(),
    };
  },

  async begin_downtime({ host, port, reason, durationMinutes = 60 }) {
    await orch.beginDowntime(host, port, 'clawsql', reason, durationMinutes * 60);
    return {
      success: true,
      message: `Downtime started for ${host}:${port} — ${reason} (${durationMinutes}min)`,
      timestamp: timestamp(),
    };
  },

  async end_downtime({ host, port }) {
    await orch.endDowntime(host, port);
    return {
      success: true,
      message: `Downtime ended for ${host}:${port}`,
      timestamp: timestamp(),
    };
  },
};
