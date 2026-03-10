/**
 * Scheduler
 *
 * Background task scheduling for health checks,
 * topology polling, replication monitoring, and schema sync.
 */
import type { TopologyService } from '../services/topology.js';
import type { HealthService } from '../services/health.js';
import type { MemoryConfig } from '../types/memory.js';
interface SchedulerConfig {
    topologyPollInterval: number;
    healthCheckInterval: number;
    replicationMonitorInterval: number;
    schemaSyncInterval?: number;
}
interface SchedulerOptions {
    memoryConfig?: MemoryConfig;
    clusterName?: string;
}
export declare class Scheduler {
    private config;
    private options;
    private topologyService;
    private healthService;
    private memoryService;
    private intervals;
    private running;
    constructor(config: SchedulerConfig, topologyService: TopologyService, healthService: HealthService, options?: SchedulerOptions);
    /**
     * Start all scheduled tasks
     */
    start(): void;
    /**
     * Run schema sync for all registered databases
     */
    private runSchemaSync;
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
    /**
     * Trigger immediate schema sync
     */
    triggerSchemaSync(): Promise<void>;
}
export declare function getScheduler(config?: SchedulerConfig, topologyService?: TopologyService, healthService?: HealthService, options?: SchedulerOptions): Scheduler;
export declare function resetScheduler(): void;
export {};
//# sourceMappingURL=index.d.ts.map