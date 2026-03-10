/**
 * Health Service
 *
 * Provides health monitoring for MySQL cluster components.
 */

import type { MySQLProvider } from '../providers/mysql.js';
import type { ProxySQLProvider } from '../providers/proxysql.js';
import { getMySQLProvider } from '../providers/mysql.js';
import { getProxySQLProvider } from '../providers/proxysql.js';
import type { TopologyService } from './topology.js';
import { getTopologyService } from './topology.js';
import { getLogger } from '../logger.js';

const log = getLogger('health-service');

export interface HealthStatus {
  healthy: boolean;
  components: {
    mysql: ComponentHealth;
    proxysql: ComponentHealth;
    topology: ComponentHealth;
  };
  timestamp: Date;
}

export interface ComponentHealth {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface InstanceHealth {
  host: string;
  port: number;
  healthy: boolean;
  pingMs: number;
  replicationLag: number | null;
  ioRunning: boolean | null;
  sqlRunning: boolean | null;
}

export class HealthService {
  private mysqlProvider: MySQLProvider;
  private proxysqlProvider: ProxySQLProvider;
  private topologyService: TopologyService;

  constructor() {
    this.mysqlProvider = getMySQLProvider();
    this.proxysqlProvider = getProxySQLProvider();
    this.topologyService = getTopologyService();
  }

  /**
   * Get overall health status
   */
  async getHealth(): Promise<HealthStatus> {
    const [mysqlHealth, proxysqlHealth, topologyHealth] = await Promise.all([
      this.getMySQLHealth(),
      this.getProxySQLHealth(),
      this.getTopologyHealth(),
    ]);

    const healthy = mysqlHealth.healthy && proxysqlHealth.healthy && topologyHealth.healthy;

    return {
      healthy,
      components: {
        mysql: mysqlHealth,
        proxysql: proxysqlHealth,
        topology: topologyHealth,
      },
      timestamp: new Date(),
    };
  }

  /**
   * Get MySQL health
   */
  async getMySQLHealth(): Promise<ComponentHealth> {
    try {
      const topology = this.topologyService.getTopology();
      const instanceHealths: InstanceHealth[] = [];

      // Check primary
      if (topology.primary) {
        const health = await this.checkInstanceHealth(topology.primary.host, topology.primary.port, false);
        instanceHealths.push(health);
      }

      // Check replicas
      for (const replica of topology.replicas) {
        const health = await this.checkInstanceHealth(replica.host, replica.port, true);
        instanceHealths.push(health);
      }

      const unhealthyCount = instanceHealths.filter(h => !h.healthy).length;
      const healthy = unhealthyCount === 0;

      return {
        healthy,
        message: healthy
          ? `All ${instanceHealths.length} instances healthy`
          : `${unhealthyCount} of ${instanceHealths.length} instances unhealthy`,
        details: { instances: instanceHealths },
      };
    } catch (error) {
      return {
        healthy: false,
        message: `MySQL health check failed: ${error}`,
      };
    }
  }

  /**
   * Check health of a specific instance
   */
  async checkInstanceHealth(host: string, port: number, checkReplication: boolean): Promise<InstanceHealth> {
    const start = Date.now();
    let healthy = false;
    let pingMs = 0;
    let replicationLag: number | null = null;
    let ioRunning: boolean | null = null;
    let sqlRunning: boolean | null = null;

    try {
      healthy = await this.mysqlProvider.ping(host, port);
      pingMs = Date.now() - start;

      if (checkReplication && healthy) {
        const replStatus = await this.mysqlProvider.getReplicationStatus(host, port);
        if (replStatus) {
          replicationLag = replStatus.secondsBehindMaster;
          ioRunning = replStatus.ioThreadRunning;
          sqlRunning = replStatus.sqlThreadRunning;
        }
      }
    } catch (error) {
      log.warn({ host, port, error }, 'Instance health check failed');
    }

    return {
      host,
      port,
      healthy,
      pingMs,
      replicationLag,
      ioRunning,
      sqlRunning,
    };
  }

  /**
   * Get ProxySQL health
   */
  async getProxySQLHealth(): Promise<ComponentHealth> {
    try {
      const healthy = await this.proxysqlProvider.ping();

      if (!healthy) {
        return {
          healthy: false,
          message: 'ProxySQL is not responding',
        };
      }

      const writers = await this.proxysqlProvider.getWriters();
      const readers = await this.proxysqlProvider.getReaders();

      const issues: string[] = [];
      if (writers.length === 0) {
        issues.push('No writers configured');
      }
      if (writers.length > 1) {
        issues.push('Multiple writers detected');
      }

      return {
        healthy: issues.length === 0,
        message: issues.length > 0 ? issues.join(', ') : `ProxySQL healthy (${writers.length} writers, ${readers.length} readers)`,
        details: { writers: writers.length, readers: readers.length },
      };
    } catch (error) {
      return {
        healthy: false,
        message: `ProxySQL health check failed: ${error}`,
      };
    }
  }

  /**
   * Get topology health
   */
  async getTopologyHealth(): Promise<ComponentHealth> {
    try {
      const topology = this.topologyService.getTopology();

      if (!topology.primary) {
        return {
          healthy: false,
          message: 'No primary detected in topology',
        };
      }

      if (topology.problems.length > 0) {
        const critical = topology.problems.filter(p => p.severity === 'critical' || p.severity === 'error');
        if (critical.length > 0) {
          return {
            healthy: false,
            message: `${critical.length} critical problem(s): ${critical.map(p => p.message).join(', ')}`,
            details: { problems: topology.problems },
          };
        }
      }

      return {
        healthy: true,
        message: `Topology healthy: 1 primary, ${topology.replicas.length} replicas`,
        details: {
          primary: `${topology.primary.host}:${topology.primary.port}`,
          replicaCount: topology.replicas.length,
          problems: topology.problems.length,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Topology health check failed: ${error}`,
      };
    }
  }

  /**
   * Get replication status summary
   */
  async getReplicationStatus(): Promise<{
    primary: string | null;
    replicas: Array<{
      host: string;
      port: number;
      lag: number | null;
      ioRunning: boolean;
      sqlRunning: boolean;
    }>;
  }> {
    const topology = this.topologyService.getTopology();
    const replicas = [];

    for (const replica of topology.replicas) {
      const replStatus = await this.mysqlProvider.getReplicationStatus(replica.host, replica.port);
      replicas.push({
        host: replica.host,
        port: replica.port,
        lag: replStatus?.secondsBehindMaster ?? null,
        ioRunning: replStatus?.ioThreadRunning ?? false,
        sqlRunning: replStatus?.sqlThreadRunning ?? false,
      });
    }

    return {
      primary: topology.primary ? `${topology.primary.host}:${topology.primary.port}` : null,
      replicas,
    };
  }
}

// Singleton instance
let _service: HealthService | null = null;

export function getHealthService(): HealthService {
  if (!_service) {
    _service = new HealthService();
  }
  return _service;
}

export function resetHealthService(): void {
  _service = null;
}