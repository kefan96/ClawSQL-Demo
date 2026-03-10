/**
 * ProxySQL Provider
 *
 * Provides ProxySQL admin interface connectivity for
 * server management, routing configuration, and monitoring.
 */
import type { Server, PoolStats, QueryRule, SyncResult } from '../types/proxysql.js';
import { Hostgroups, type HostgroupValue } from '../types/proxysql.js';
interface ProxySQLProviderConfig {
    host: string;
    adminPort: number;
    dataPort: number;
    user: string;
    password: string;
    hostgroups: {
        writer: number;
        reader: number;
    };
}
export declare class ProxySQLProvider {
    private pool;
    private dataPool;
    private config;
    constructor(config: ProxySQLProviderConfig);
    /**
     * Get or create the connection pool
     */
    private getPool;
    /**
     * Get or create the data connection pool (for SQL execution)
     */
    private getDataPool;
    /**
     * Execute a SQL query on the data port
     */
    executeSQL(sql: string, database?: string, timeout?: number): Promise<{
        columns: string[];
        rows: Record<string, unknown>[];
        rowCount: number;
    }>;
    /**
     * Get database schema information
     */
    getSchema(database?: string): Promise<{
        database: string;
        tables: Array<{
            name: string;
            columns: Array<{
                name: string;
                type: string;
                nullable: boolean;
                key: string | null;
            }>;
        }>;
    }>;
    /**
     * Execute a query
     */
    private query;
    /**
     * Execute a statement
     */
    private execute;
    /**
     * Get all servers
     */
    getServers(): Promise<Server[]>;
    /**
     * Get writers (primary servers)
     */
    getWriters(): Promise<Server[]>;
    /**
     * Get readers (replica servers)
     */
    getReaders(): Promise<Server[]>;
    /**
     * Add a server to a hostgroup
     */
    addServer(hostgroup: HostgroupValue, hostname: string, port?: number, weight?: number, maxConnections?: number): Promise<void>;
    /**
     * Remove a server from a specific hostgroup or all hostgroups
     */
    removeServer(hostname: string, port: number, hostgroup?: HostgroupValue): Promise<void>;
    /**
     * Set server status
     */
    setServerStatus(hostname: string, port: number, hostgroup: HostgroupValue, status: 'ONLINE' | 'OFFLINE' | 'SHUNNED'): Promise<void>;
    /**
     * Update server hostgroup (for switchover)
     */
    updateServerHostgroup(hostname: string, port: number, fromHostgroup: HostgroupValue, toHostgroup: HostgroupValue): Promise<void>;
    /**
     * Atomic writer switch:
     *   1. Remove old writer from writer hostgroup
     *   2. Add old writer to reader hostgroup
     *   3. Remove new writer from reader hostgroup
     *   4. Add new writer to writer hostgroup
     */
    switchWriter(oldHost: string, oldPort: number, newHost: string, newPort: number): Promise<void>;
    /**
     * Sync ProxySQL with topology
     */
    syncTopology(primary: string, replicas: string[], primaryPort?: number): Promise<SyncResult>;
    /**
     * Get connection pool statistics
     */
    getPoolStats(): Promise<PoolStats[]>;
    /**
     * Get query rules
     */
    getQueryRules(): Promise<QueryRule[]>;
    /**
     * Load servers to runtime and save to disk
     */
    loadServers(): Promise<void>;
    /**
     * Load query rules to runtime and save to disk
     */
    loadQueryRules(): Promise<void>;
    /**
     * Ping ProxySQL admin interface
     */
    ping(): Promise<boolean>;
    /**
     * Close the connection pool
     */
    destroy(): Promise<void>;
}
export declare function getProxySQLProvider(config?: ProxySQLProviderConfig): ProxySQLProvider;
export declare function resetProxySQLProvider(): void;
export { Hostgroups, HostgroupValue };
//# sourceMappingURL=proxysql.d.ts.map