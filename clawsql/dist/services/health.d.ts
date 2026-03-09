/**
 * Health Service
 *
 * Provides health monitoring for MySQL cluster components.
 */
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
export declare class HealthService {
    private mysqlProvider;
    private proxysqlProvider;
    private topologyService;
    constructor();
    /**
     * Get overall health status
     */
    getHealth(): Promise<HealthStatus>;
    /**
     * Get MySQL health
     */
    getMySQLHealth(): Promise<ComponentHealth>;
    /**
     * Check health of a specific instance
     */
    checkInstanceHealth(host: string, port: number, checkReplication: boolean): Promise<InstanceHealth>;
    /**
     * Get ProxySQL health
     */
    getProxySQLHealth(): Promise<ComponentHealth>;
    /**
     * Get topology health
     */
    getTopologyHealth(): Promise<ComponentHealth>;
    /**
     * Get replication status summary
     */
    getReplicationStatus(): Promise<{
        primary: string | null;
        replicas: Array<{
            host: string;
            port: number;
            lag: number | null;
            ioRunning: boolean;
            sqlRunning: boolean;
        }>;
    }>;
}
export declare function getHealthService(): HealthService;
export declare function resetHealthService(): void;
//# sourceMappingURL=health.d.ts.map