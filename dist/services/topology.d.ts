/**
 * Topology Service
 *
 * Core topology management for MySQL clusters.
 * Replaces Orchestrator's topology discovery and monitoring.
 */
import type { Instance } from '../types/mysql.js';
import type { Topology, Problem, InstanceWithReplication } from '../types/topology.js';
import type { EventHandler } from '../types/events.js';
import type { MemoryConfig } from '../types/memory.js';
interface TopologyServiceConfig {
    clusterName: string;
    seeds: string[];
    pollInterval: number;
    memoryConfig?: MemoryConfig;
}
export declare class TopologyService {
    private mysqlProvider;
    private config;
    private currentTopology;
    private pollTimer;
    private eventHandlers;
    private previousTopology;
    constructor(config: TopologyServiceConfig);
    /**
     * Discover cluster topology from seed hosts
     */
    discoverCluster(): Promise<Topology>;
    /**
     * Capture schemas for all databases in background
     */
    private captureSchemasInBackground;
    /**
     * Refresh topology (trigger immediate discovery)
     */
    refreshTopology(): Promise<void>;
    /**
     * Get current topology
     */
    getTopology(): Topology;
    /**
     * Get current primary
     */
    getPrimary(): Instance | null;
    /**
     * Get all replicas
     */
    getReplicas(): Instance[];
    /**
     * Get current problems
     */
    getProblems(): Problem[];
    /**
     * Get an instance by host:port
     */
    getInstance(host: string, port?: number): InstanceWithReplication | undefined;
    /**
     * Detect problems in the topology
     */
    private detectProblems;
    /**
     * Calculate difference between two topologies
     */
    private diffTopology;
    /**
     * Emit a topology change event
     */
    private emitTopologyChange;
    /**
     * Emit an event to handlers
     */
    private emit;
    /**
     * Register an event handler
     */
    on(type: string, handler: EventHandler): void;
    /**
     * Remove an event handler
     */
    off(type: string, handler: EventHandler): void;
    /**
     * Start periodic topology polling
     */
    startPolling(interval?: number): void;
    /**
     * Stop polling
     */
    stopPolling(): void;
    /**
     * Clean up resources
     */
    destroy(): Promise<void>;
}
export declare function getTopologyService(config?: TopologyServiceConfig): TopologyService;
export declare function resetTopologyService(): void;
export {};
//# sourceMappingURL=topology.d.ts.map