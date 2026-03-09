/**
 * ProxySQL Provider
 *
 * Provides ProxySQL admin interface connectivity for
 * server management, routing configuration, and monitoring.
 */

import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import type { Server, PoolStats, QueryRule, SyncResult } from '../types/proxysql.js';
import { Hostgroups, type HostgroupValue } from '../types/proxysql.js';
import { getLogger } from '../logger.js';

const log = getLogger('proxysql-provider');

interface ProxySQLProviderConfig {
  host: string;
  adminPort: number;
  user: string;
  password: string;
  hostgroups: {
    writer: number;
    reader: number;
  };
}

export class ProxySQLProvider {
  private pool: Pool | null = null;
  private config: ProxySQLProviderConfig;

  constructor(config: ProxySQLProviderConfig) {
    this.config = config;
  }

  /**
   * Get or create the connection pool
   */
  private getPool(): Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        host: this.config.host,
        port: this.config.adminPort,
        user: this.config.user,
        password: this.config.password,
        database: 'main',
        waitForConnections: true,
        connectionLimit: 5,
        connectTimeout: 5000,
      });
      log.debug({ host: this.config.host, port: this.config.adminPort }, 'Created ProxySQL connection pool');
    }
    return this.pool;
  }

  /**
   * Execute a query
   */
  private async query<T extends RowDataPacket[]>(sql: string): Promise<T> {
    const pool = this.getPool();
    const [rows] = await pool.query<T>(sql);
    return rows;
  }

  /**
   * Execute a statement
   */
  private async execute(sql: string): Promise<void> {
    const pool = this.getPool();
    await pool.execute(sql);
  }

  // ─── Server Management ──────────────────────────────────────────────────

  /**
   * Get all servers
   */
  async getServers(): Promise<Server[]> {
    const rows = await this.query<RowDataPacket[]>(
      'SELECT * FROM mysql_servers ORDER BY hostgroup_id, hostname'
    );

    return rows.map(row => ({
      hostgroupId: row.hostgroup_id,
      hostname: row.hostname,
      port: row.port,
      status: row.status,
      weight: row.weight,
      maxConnections: row.max_connections,
      useSsl: row.use_ssl === 1,
      maxLatencyMs: row.max_latency_ms,
      comment: row.comment ?? '',
    }));
  }

  /**
   * Get writers (primary servers)
   */
  async getWriters(): Promise<Server[]> {
    const servers = await this.getServers();
    return servers.filter(s => s.hostgroupId === this.config.hostgroups.writer);
  }

  /**
   * Get readers (replica servers)
   */
  async getReaders(): Promise<Server[]> {
    const servers = await this.getServers();
    return servers.filter(s => s.hostgroupId === this.config.hostgroups.reader);
  }

  /**
   * Add a server to a hostgroup
   */
  async addServer(
    hostgroup: HostgroupValue,
    hostname: string,
    port: number = 3306,
    weight: number = 1000,
    maxConnections: number = 200
  ): Promise<void> {
    await this.execute(
      `INSERT OR REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
       VALUES (${hostgroup}, '${hostname}', ${port}, ${weight}, ${maxConnections})`
    );
    await this.loadServers();
    log.info({ hostgroup, hostname, port }, 'Server added');
  }

  /**
   * Remove a server from a specific hostgroup or all hostgroups
   */
  async removeServer(hostname: string, port: number, hostgroup?: HostgroupValue): Promise<void> {
    const hgClause = hostgroup !== undefined ? ` AND hostgroup_id = ${hostgroup}` : '';
    await this.execute(
      `DELETE FROM mysql_servers WHERE hostname='${hostname}' AND port=${port}${hgClause}`
    );
    await this.loadServers();
    log.info({ hostname, port, hostgroup }, 'Server removed');
  }

  /**
   * Set server status
   */
  async setServerStatus(
    hostname: string,
    port: number,
    hostgroup: HostgroupValue,
    status: 'ONLINE' | 'OFFLINE' | 'SHUNNED'
  ): Promise<void> {
    await this.execute(
      `UPDATE mysql_servers SET status='${status}'
       WHERE hostname='${hostname}' AND port=${port} AND hostgroup_id=${hostgroup}`
    );
    await this.loadServers();
    log.info({ hostname, port, hostgroup, status }, 'Server status updated');
  }

  /**
   * Update server hostgroup (for switchover)
   */
  async updateServerHostgroup(
    hostname: string,
    port: number,
    fromHostgroup: HostgroupValue,
    toHostgroup: HostgroupValue
  ): Promise<void> {
    await this.execute(
      `DELETE FROM mysql_servers WHERE hostname='${hostname}' AND port=${port} AND hostgroup_id=${fromHostgroup}`
    );
    await this.execute(
      `INSERT OR REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
       VALUES (${toHostgroup}, '${hostname}', ${port}, 1000, 200)`
    );
    await this.loadServers();
    log.info({ hostname, port, fromHostgroup, toHostgroup }, 'Server hostgroup updated');
  }

  /**
   * Atomic writer switch:
   *   1. Remove old writer from writer hostgroup
   *   2. Add old writer to reader hostgroup
   *   3. Remove new writer from reader hostgroup
   *   4. Add new writer to writer hostgroup
   */
  async switchWriter(
    oldHost: string,
    oldPort: number,
    newHost: string,
    newPort: number
  ): Promise<void> {
    const writerHG = this.config.hostgroups.writer;
    const readerHG = this.config.hostgroups.reader;

    log.info({ old: `${oldHost}:${oldPort}`, new: `${newHost}:${newPort}` }, 'Switching writer');

    // Step 1: Remove old writer from writer hostgroup
    await this.execute(
      `DELETE FROM mysql_servers WHERE hostname='${oldHost}' AND port=${oldPort} AND hostgroup_id=${writerHG}`
    );

    // Step 2: Old writer becomes reader
    await this.execute(
      `INSERT OR REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
       VALUES (${readerHG}, '${oldHost}', ${oldPort}, 1000, 200)`
    );

    // Step 3: Remove new writer from readers
    await this.execute(
      `DELETE FROM mysql_servers WHERE hostname='${newHost}' AND port=${newPort} AND hostgroup_id=${readerHG}`
    );

    // Step 4: New writer
    await this.execute(
      `INSERT OR REPLACE INTO mysql_servers (hostgroup_id, hostname, port, weight, max_connections)
       VALUES (${writerHG}, '${newHost}', ${newPort}, 1000, 200)`
    );

    await this.loadServers();
    log.info({ old: `${oldHost}:${oldPort}`, new: `${newHost}:${newPort}` }, 'Writer switched');
  }

  // ─── Sync Operations ─────────────────────────────────────────────────────

  /**
   * Sync ProxySQL with topology
   */
  async syncTopology(
    primary: string,
    replicas: string[],
    primaryPort: number = 3306
  ): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      added: [],
      removed: [],
      unchanged: [],
      errors: [],
    };

    const writerHG = this.config.hostgroups.writer;
    const readerHG = this.config.hostgroups.reader;

    try {
      // Get current servers
      const currentServers = await this.getServers();
      const currentWriters = currentServers.filter(s => s.hostgroupId === writerHG);
      const currentReaders = currentServers.filter(s => s.hostgroupId === readerHG);

      const currentWriterSet = new Set(
        currentWriters.map(s => `${s.hostname}:${s.port}`)
      );
      const currentReaderSet = new Set(
        currentReaders.map(s => `${s.hostname}:${s.port}`)
      );

      // Expected topology
      const expectedWriter = `${primary}:${primaryPort}`;
      const expectedReaders = new Set(replicas.map(r => `${r}:${primaryPort}`));

      // Check if writer needs to change
      if (!currentWriterSet.has(expectedWriter)) {
        // Remove old writers
        for (const writer of currentWriters) {
          await this.removeServer(writer.hostname, writer.port, writerHG as HostgroupValue);
          result.removed.push(`${writer.hostname}:${writer.port}`);
        }

        // Add new writer
        await this.addServer(writerHG as HostgroupValue, primary, primaryPort);
        result.added.push(expectedWriter);
      } else {
        result.unchanged.push(expectedWriter);
      }

      // Check readers
      for (const reader of replicas) {
        const readerAddr = `${reader}:${primaryPort}`;
        if (!currentReaderSet.has(readerAddr)) {
          try {
            await this.addServer(readerHG as HostgroupValue, reader, primaryPort);
            result.added.push(readerAddr);
          } catch (error) {
            result.errors.push(`Failed to add reader ${readerAddr}: ${error}`);
            result.success = false;
          }
        } else {
          result.unchanged.push(readerAddr);
        }
      }

      // Remove stale readers
      for (const reader of currentReaders) {
        const readerAddr = `${reader.hostname}:${reader.port}`;
        if (!expectedReaders.has(readerAddr) && readerAddr !== expectedWriter) {
          await this.removeServer(reader.hostname, reader.port, readerHG as HostgroupValue);
          result.removed.push(readerAddr);
        }
      }

    } catch (error) {
      result.errors.push(`Sync failed: ${error}`);
      result.success = false;
    }

    log.info(result, 'Topology sync completed');
    return result;
  }

  // ─── Monitoring ──────────────────────────────────────────────────────────

  /**
   * Get connection pool statistics
   */
  async getPoolStats(): Promise<PoolStats[]> {
    const rows = await this.query<RowDataPacket[]>(
      'SELECT * FROM stats_mysql_connection_pool'
    );

    return rows.map(row => ({
      hostgroupId: row.hostgroup,
      srvHost: row.srv_host,
      srvPort: row.srv_port,
      status: row.status,
      connUsed: row.ConnUsed,
      connFree: row.ConnFree,
      connOk: row.ConnOK,
      connErr: row.ConnERR,
      queries: row.Queries,
      bytesDataSent: row.Bytes_data_sent,
      bytesDataRecv: row.Bytes_data_recv,
      latencyUs: row.Latency_us,
    }));
  }

  /**
   * Get query rules
   */
  async getQueryRules(): Promise<QueryRule[]> {
    const rows = await this.query<RowDataPacket[]>(
      'SELECT * FROM mysql_query_rules ORDER BY rule_id'
    );

    return rows.map(row => ({
      ruleId: row.rule_id,
      active: row.active,
      username: row.username,
      schemaname: row.schemaname,
      flagIn: row.flagIN,
      matchPattern: row.match_pattern,
      negateMatchPattern: row.negate_match_pattern,
      flagOut: row.flagOUT,
      replacePattern: row.replace_pattern,
      destinationHostgroup: row.destination_hostgroup,
      cacheTtl: row.cache_ttl,
      reconnect: row.reconnect,
      timeout: row.timeout,
      retries: row.retries,
      delay: row.delay,
      nextQueryFlagIn: row.next_query_flagIN,
      mirrorFlagOut: row.mirror_flagOUT,
      mirrorHostgroup: row.mirror_hostgroup,
      errorMsg: row.error_msg,
      okMsg: row.ok_msg,
      stickyConn: row.sticky_conn,
      multiplex: row.multiplex,
      gtidFromHostgroup: row.gtid_from_hostgroup,
      log: row.log,
      apply: row.apply,
      comment: row.comment,
    }));
  }

  // ─── Admin Operations ─────────────────────────────────────────────────────

  /**
   * Load servers to runtime and save to disk
   */
  async loadServers(): Promise<void> {
    await this.execute('LOAD MYSQL SERVERS TO RUNTIME');
    await this.execute('SAVE MYSQL SERVERS TO DISK');
  }

  /**
   * Load query rules to runtime and save to disk
   */
  async loadQueryRules(): Promise<void> {
    await this.execute('LOAD MYSQL QUERY RULES TO RUNTIME');
    await this.execute('SAVE MYSQL QUERY RULES TO DISK');
  }

  // ─── Health ───────────────────────────────────────────────────────────────

  /**
   * Ping ProxySQL admin interface
   */
  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  /**
   * Close the connection pool
   */
  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      log.debug('Closed ProxySQL connection pool');
    }
  }
}

// Singleton instance
let _provider: ProxySQLProvider | null = null;

export function getProxySQLProvider(config?: ProxySQLProviderConfig): ProxySQLProvider {
  if (!_provider && config) {
    _provider = new ProxySQLProvider(config);
  }
  if (!_provider) {
    throw new Error('ProxySQL provider not initialized');
  }
  return _provider;
}

export function resetProxySQLProvider(): void {
  _provider = null;
}

export { Hostgroups, HostgroupValue };