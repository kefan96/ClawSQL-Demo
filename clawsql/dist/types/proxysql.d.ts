/**
 * ProxySQL Types
 */
export declare const Hostgroups: {
    readonly WRITER: 10;
    readonly READER: 20;
    readonly BACKUP: 30;
};
export type HostgroupValue = typeof Hostgroups[keyof typeof Hostgroups];
export interface ProxySQLConnectionConfig {
    host: string;
    adminPort: number;
    user: string;
    password: string;
    hostgroups: {
        writer: number;
        reader: number;
    };
}
export interface Server {
    hostgroupId: number;
    hostname: string;
    port: number;
    status: 'ONLINE' | 'OFFLINE' | 'SHUNNED';
    weight: number;
    maxConnections: number;
    useSsl: boolean;
    maxLatencyMs: number;
    comment: string;
}
export interface PoolStats {
    hostgroupId: number;
    srvHost: string;
    srvPort: number;
    status: string;
    connUsed: number;
    connFree: number;
    connOk: number;
    connErr: number;
    queries: number;
    bytesDataSent: number;
    bytesDataRecv: number;
    latencyUs: number;
}
export interface QueryRule {
    ruleId: number;
    active: number;
    username: string | null;
    schemaname: string | null;
    flagIn: number;
    matchPattern: string | null;
    negateMatchPattern: number;
    flagOut: number | null;
    replacePattern: string | null;
    destinationHostgroup: number | null;
    cacheTtl: number | null;
    reconnect: number | null;
    timeout: number | null;
    retries: number | null;
    delay: number | null;
    nextQueryFlagIn: number | null;
    mirrorFlagOut: number | null;
    mirrorHostgroup: number | null;
    errorMsg: string | null;
    okMsg: string | null;
    stickyConn: number | null;
    multiplex: number | null;
    gtidFromHostgroup: number | null;
    log: number | null;
    apply: number | null;
    comment: string | null;
}
export interface SyncResult {
    success: boolean;
    added: string[];
    removed: string[];
    unchanged: string[];
    errors: string[];
}
//# sourceMappingURL=proxysql.d.ts.map