/**
 * MySQL Instance Types
 */
export interface MySQLConnectionConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database?: string;
    connectionLimit?: number;
    connectTimeout?: number;
}
export interface Instance {
    host: string;
    port: number;
    serverId: number;
    version: string;
    readOnly: boolean;
    isPrimary: boolean;
    isReplica: boolean;
    lastSeen: Date;
}
export interface ReplicationStatus {
    ioThreadRunning: boolean;
    sqlThreadRunning: boolean;
    secondsBehindMaster: number | null;
    masterHost: string | null;
    masterPort: number | null;
    gtidsExecuted: string;
    gtidsPurged: string;
    relayMasterLog: string | null;
    execMasterLogPos: number | null;
    readMasterLogPos: number | null;
}
export interface MasterStatus {
    file: string;
    position: number;
    gtidsExecuted: string;
}
export interface SlaveHost {
    serverId: number;
    host: string;
    port: number;
    masterId: number;
}
export interface ProcesslistEntry {
    id: number;
    user: string;
    host: string;
    db: string | null;
    command: string;
    time: number;
    state: string | null;
    info: string | null;
}
export interface GTID {
    sourceId: string;
    transactionId: number;
}
export interface GTIDSet {
    uuid: string;
    intervals: Array<[number, number]>;
}
/**
 * Parse GTID string into structured format
 */
export declare function parseGTID(gtidString: string): GTIDSet[];
/**
 * Check if GTID A includes GTID B (A has all transactions B has)
 */
export declare function gtidIncludes(gtidA: string, gtidB: string): boolean;
//# sourceMappingURL=mysql.d.ts.map