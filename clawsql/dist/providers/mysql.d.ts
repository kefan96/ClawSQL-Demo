/**
 * MySQL Provider
 *
 * Provides direct MySQL connectivity for topology discovery,
 * replication monitoring, and failover operations.
 */
import type { Instance, ReplicationStatus, MasterStatus, SlaveHost, ProcesslistEntry } from '../types/mysql.js';
export declare class MySQLProvider {
    private pools;
    private defaultConfig;
    constructor(config: {
        user: string;
        password: string;
        connectionLimit?: number;
        connectTimeout?: number;
    });
    /**
     * Get a connection pool for a specific host
     */
    private getPool;
    /**
     * Execute a query on a specific host
     */
    private query;
    /**
     * Execute a statement on a specific host
     */
    private execute;
    /**
     * Get basic instance information
     */
    getInstance(host: string, port?: number): Promise<Instance>;
    /**
     * Discover all instances in a cluster starting from seed hosts
     */
    discoverInstances(seeds: string[]): Promise<Instance[]>;
    /**
     * Get connected slave hosts from a primary
     */
    getSlaveHosts(host: string, port?: number): Promise<SlaveHost[]>;
    /**
     * Get replication status for a replica
     */
    getReplicationStatus(host: string, port?: number): Promise<ReplicationStatus | null>;
    /**
     * Get master status
     */
    getMasterStatus(host: string, port?: number): Promise<MasterStatus | null>;
    /**
     * Setup replication from a replica to a primary
     */
    setupReplication(replicaHost: string, replicaPort: number, primaryHost: string, primaryPort: number, replicationUser?: string, replicationPassword?: string): Promise<void>;
    /**
     * Start slave threads
     */
    startSlave(host: string, port?: number): Promise<void>;
    /**
     * Stop slave threads
     */
    stopSlave(host: string, port?: number): Promise<void>;
    /**
     * Set read_only mode
     */
    setReadOnly(host: string, port: number | undefined, readOnly: boolean): Promise<void>;
    /**
     * Get GTID_EXECUTED
     */
    getGTIDExecuted(host: string, port?: number): Promise<string>;
    /**
     * Wait for a replica to catch up to a GTID position
     */
    waitForGTID(host: string, port: number, targetGTID: string, timeoutMs?: number): Promise<boolean>;
    /**
     * Check if GTID set A includes GTID set B
     */
    private gtidIncludes;
    /**
     * Promote a replica to primary
     */
    promoteToPrimary(host: string, port?: number): Promise<void>;
    /**
     * Demote a primary to replica
     */
    demoteToReplica(host: string, port: number, newPrimaryHost: string, newPrimaryPort?: number): Promise<void>;
    /**
     * Ping a MySQL instance
     */
    ping(host: string, port?: number): Promise<boolean>;
    /**
     * Get MySQL version
     */
    getVersion(host: string, port?: number): Promise<string>;
    /**
     * Get processlist
     */
    getProcesslist(host: string, port?: number): Promise<ProcesslistEntry[]>;
    /**
     * Close all connection pools
     */
    destroy(): Promise<void>;
}
export declare function getMySQLProvider(config?: {
    user: string;
    password: string;
    connectionLimit?: number;
    connectTimeout?: number;
}): MySQLProvider;
export declare function resetMySQLProvider(): void;
//# sourceMappingURL=mysql.d.ts.map