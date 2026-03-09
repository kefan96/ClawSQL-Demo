/**
 * Scheduler
 *
 * Background task scheduling for health checks,
 * topology polling, and replication monitoring.
 */
import type { TopologyService } from '../services/topology.js';
import type { HealthService } from '../services/health.js';
interface SchedulerConfig {
    topologyPollInterval: number;
    healthCheckInterval: number;
    replicationMonitorInterval: number;
}
export declare class Scheduler {
    private config;
    private topologyService;
    private healthService;
    private intervals;
    private running;
    constructor(config: SchedulerConfig, topologyService: TopologyService, healthService: HealthService);
    /**
     * Start all scheduled tasks
     */
    start(): void;
    /**
     * Stop all scheduled tasks
     */
    stop(): void;
    /**
     * Schedule a periodic task
     */
    private schedule;
    /**
     * Check if scheduler is running
     */
    isRunning(): boolean;
}
export declare function getScheduler(config?: SchedulerConfig, topologyService?: TopologyService, healthService?: HealthService): Scheduler;
export declare function resetScheduler(): void;
export {};
//# sourceMappingURL=index.d.ts.map