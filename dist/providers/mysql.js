/**
 * MySQL Provider
 *
 * Provides direct MySQL connectivity for topology discovery,
 * replication monitoring, and failover operations.
 */
import mysql from 'mysql2/promise';
import { getLogger } from '../logger.js';
const log = getLogger('mysql-provider');
export class MySQLProvider {
    pools = new Map();
    defaultConfig;
    constructor(config) {
        this.defaultConfig = {
            user: config.user,
            password: config.password,
            connectionLimit: config.connectionLimit ?? 10,
            connectTimeout: config.connectTimeout ?? 5000,
        };
    }
    /**
     * Get a connection pool for a specific host
     */
    getPool(host, port = 3306) {
        const key = `${host}:${port}`;
        let entry = this.pools.get(key);
        if (!entry) {
            const pool = mysql.createPool({
                host,
                port,
                user: this.defaultConfig.user,
                password: this.defaultConfig.password,
                connectionLimit: this.defaultConfig.connectionLimit,
                connectTimeout: this.defaultConfig.connectTimeout,
                waitForConnections: true,
                queueLimit: 0,
            });
            entry = {
                pool,
                lastUsed: Date.now(),
            };
            this.pools.set(key, entry);
            log.debug({ host, port }, 'Created new connection pool');
        }
        else {
            entry.lastUsed = Date.now();
        }
        return entry.pool;
    }
    /**
     * Execute a query on a specific host
     */
    async query(host, port, sql) {
        const pool = this.getPool(host, port);
        const [rows] = await pool.query(sql);
        return rows;
    }
    /**
     * Execute a statement on a specific host
     */
    async execute(host, port, sql) {
        const pool = this.getPool(host, port);
        await pool.execute(sql);
    }
    // ─── Discovery ────────────────────────────────────────────────────────
    /**
     * Get basic instance information
     */
    async getInstance(host, port = 3306) {
        const versionRows = await this.query(host, port, 'SELECT VERSION() as version');
        const serverIdRows = await this.query(host, port, 'SELECT @@server_id as serverId');
        const readOnlyRows = await this.query(host, port, 'SELECT @@read_only as readOnly');
        const versionRow = versionRows[0];
        const serverIdRow = serverIdRows[0];
        const readOnlyRow = readOnlyRows[0];
        const readOnly = readOnlyRow?.readOnly === 1;
        const isPrimary = !readOnly;
        return {
            host,
            port,
            serverId: serverIdRow?.serverId ?? 0,
            version: versionRow?.version ?? 'unknown',
            readOnly,
            isPrimary,
            isReplica: !isPrimary,
            lastSeen: new Date(),
        };
    }
    /**
     * Discover all instances in a cluster starting from seed hosts
     */
    async discoverInstances(seeds) {
        const discovered = new Map();
        const queue = [...seeds];
        while (queue.length > 0) {
            const seed = queue.shift();
            const parts = seed.split(':');
            const host = parts[0] ?? '';
            const port = parts[1] ? parseInt(parts[1], 10) : 3306;
            const key = `${host}:${port}`;
            if (discovered.has(key) || !host)
                continue;
            try {
                log.debug({ host, port }, 'Discovering instance');
                const instance = await this.getInstance(host, port);
                discovered.set(key, instance);
                // If this is a primary, find connected replicas via SHOW SLAVE HOSTS
                if (instance.isPrimary) {
                    const slaveHosts = await this.getSlaveHosts(host, port);
                    for (const slave of slaveHosts) {
                        const slaveKey = `${slave.host}:${slave.port}`;
                        if (!discovered.has(slaveKey)) {
                            queue.push(slaveKey);
                        }
                    }
                }
                // If this is a replica, discover the primary
                if (instance.isReplica) {
                    const replStatus = await this.getReplicationStatus(host, port);
                    if (replStatus?.masterHost) {
                        const masterKey = `${replStatus.masterHost}:${replStatus.masterPort ?? 3306}`;
                        if (!discovered.has(masterKey)) {
                            queue.push(masterKey);
                        }
                    }
                }
            }
            catch (error) {
                log.warn({ host, port, error }, 'Failed to discover instance');
            }
        }
        return Array.from(discovered.values());
    }
    /**
     * Get connected slave hosts from a primary
     */
    async getSlaveHosts(host, port = 3306) {
        try {
            const rows = await this.query(host, port, 'SHOW SLAVE HOSTS');
            return rows.map(row => ({
                serverId: row.Server_id,
                host: row.Host,
                port: row.Port,
                masterId: row.Master_id,
            }));
        }
        catch (error) {
            log.warn({ host, port, error }, 'Failed to get slave hosts');
            return [];
        }
    }
    // ─── Replication ────────────────────────────────────────────────────────
    /**
     * Get replication status for a replica
     */
    async getReplicationStatus(host, port = 3306) {
        try {
            const rows = await this.query(host, port, 'SHOW SLAVE STATUS');
            if (!rows || rows.length === 0) {
                return null;
            }
            const row = rows[0];
            if (!row)
                return null;
            return {
                ioThreadRunning: row.Slave_IO_Running === 'Yes',
                sqlThreadRunning: row.Slave_SQL_Running === 'Yes',
                secondsBehindMaster: row.Seconds_Behind_Master ?? null,
                masterHost: row.Master_Host ?? null,
                masterPort: row.Master_Port ?? null,
                gtidsExecuted: row.Retrieved_Gtid_Set ?? '',
                gtidsPurged: '',
                relayMasterLog: row.Relay_Master_Log_File ?? null,
                execMasterLogPos: row.Exec_Master_Log_Pos ?? null,
                readMasterLogPos: row.Read_Master_Log_Pos ?? null,
            };
        }
        catch (error) {
            log.warn({ host, port, error }, 'Failed to get replication status');
            return null;
        }
    }
    /**
     * Get master status
     */
    async getMasterStatus(host, port = 3306) {
        try {
            const rows = await this.query(host, port, 'SHOW MASTER STATUS');
            if (!rows || rows.length === 0) {
                return null;
            }
            const row = rows[0];
            if (!row)
                return null;
            return {
                file: row.File ?? '',
                position: row.Position ?? 0,
                gtidsExecuted: row.Executed_Gtid_Set ?? '',
            };
        }
        catch (error) {
            log.warn({ host, port, error }, 'Failed to get master status');
            return null;
        }
    }
    /**
     * Setup replication from a replica to a primary
     */
    async setupReplication(replicaHost, replicaPort, primaryHost, primaryPort, replicationUser, replicationPassword) {
        const user = replicationUser ?? this.defaultConfig.user;
        const password = replicationPassword ?? this.defaultConfig.password;
        // Stop any existing replication
        await this.stopSlave(replicaHost, replicaPort);
        // Configure replication
        await this.execute(replicaHost, replicaPort, `
      CHANGE REPLICATION SOURCE TO
        SOURCE_HOST = '${primaryHost}',
        SOURCE_PORT = ${primaryPort},
        SOURCE_USER = '${user}',
        SOURCE_PASSWORD = '${password}',
        SOURCE_AUTO_POSITION = 1
    `);
        // Start replication
        await this.startSlave(replicaHost, replicaPort);
        log.info({ replica: `${replicaHost}:${replicaPort}`, primary: `${primaryHost}:${primaryPort}` }, 'Replication configured');
    }
    /**
     * Start slave threads
     */
    async startSlave(host, port = 3306) {
        await this.execute(host, port, 'START SLAVE');
        log.info({ host, port }, 'Slave started');
    }
    /**
     * Stop slave threads
     */
    async stopSlave(host, port = 3306) {
        try {
            await this.execute(host, port, 'STOP SLAVE');
            log.info({ host, port }, 'Slave stopped');
        }
        catch (error) {
            log.warn({ host, port, error }, 'Failed to stop slave (may not be running)');
        }
    }
    // ─── Failover Helpers ───────────────────────────────────────────────────
    /**
     * Set read_only mode
     */
    async setReadOnly(host, port = 3306, readOnly) {
        await this.execute(host, port, `SET GLOBAL read_only = ${readOnly ? 'ON' : 'OFF'}`);
        log.info({ host, port, readOnly }, 'Read-only mode changed');
    }
    /**
     * Get GTID_EXECUTED
     */
    async getGTIDExecuted(host, port = 3306) {
        const rows = await this.query(host, port, 'SELECT @@GLOBAL.GTID_EXECUTED as gtid');
        const row = rows[0];
        return row?.gtid ?? '';
    }
    /**
     * Wait for a replica to catch up to a GTID position
     */
    async waitForGTID(host, port, targetGTID, timeoutMs = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const currentGTID = await this.getGTIDExecuted(host, port);
            if (this.gtidIncludes(currentGTID, targetGTID)) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }
    /**
     * Check if GTID set A includes GTID set B
     */
    gtidIncludes(gtidA, gtidB) {
        if (!gtidB)
            return true;
        if (!gtidA)
            return false;
        // Simple check - for production, use a proper GTID library
        // This is a basic implementation that may not handle all cases
        return gtidA.includes(gtidB) || gtidA === gtidB;
    }
    /**
     * Promote a replica to primary
     */
    async promoteToPrimary(host, port = 3306) {
        // Stop slave threads first
        await this.stopSlave(host, port);
        // Disable read_only
        await this.setReadOnly(host, port, false);
        log.info({ host, port }, 'Instance promoted to primary');
    }
    /**
     * Demote a primary to replica
     */
    async demoteToReplica(host, port, newPrimaryHost, newPrimaryPort = 3306) {
        // Enable read_only
        await this.setReadOnly(host, port, true);
        // Setup replication to new primary
        await this.setupReplication(host, port, newPrimaryHost, newPrimaryPort);
        // Start slave
        await this.startSlave(host, port);
        log.info({ host, port, newPrimary: `${newPrimaryHost}:${newPrimaryPort}` }, 'Instance demoted to replica');
    }
    // ─── Health ─────────────────────────────────────────────────────────────
    /**
     * Ping a MySQL instance
     */
    async ping(host, port = 3306) {
        try {
            await this.query(host, port, 'SELECT 1');
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Get MySQL version
     */
    async getVersion(host, port = 3306) {
        const rows = await this.query(host, port, 'SELECT VERSION() as version');
        const row = rows[0];
        return row?.version ?? 'unknown';
    }
    /**
     * Get processlist
     */
    async getProcesslist(host, port = 3306) {
        const rows = await this.query(host, port, 'SHOW PROCESSLIST');
        return rows.map(row => ({
            id: row.Id,
            user: row.User,
            host: row.Host,
            db: row.db,
            command: row.Command,
            time: row.Time,
            state: row.State,
            info: row.Info,
        }));
    }
    // ─── Cleanup ─────────────────────────────────────────────────────────────
    /**
     * Close all connection pools
     */
    async destroy() {
        for (const [key, entry] of this.pools) {
            try {
                await entry.pool.end();
                log.debug({ key }, 'Closed connection pool');
            }
            catch (error) {
                log.warn({ key, error }, 'Error closing connection pool');
            }
        }
        this.pools.clear();
    }
}
// Singleton instance
let _provider = null;
export function getMySQLProvider(config) {
    if (!_provider && config) {
        _provider = new MySQLProvider(config);
    }
    if (!_provider) {
        throw new Error('MySQL provider not initialized');
    }
    return _provider;
}
export function resetMySQLProvider() {
    _provider = null;
}
//# sourceMappingURL=mysql.js.map