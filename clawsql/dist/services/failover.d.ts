/**
 * Failover Service
 *
 * Handles graceful switchover and automatic failover
 * for MySQL clusters.
 */
import type { SwitchoverCheck, SwitchoverResult, FailoverResult, PromoteResult, RollbackResult, ValidationResult, FailoverState } from '../types/failover.js';
interface FailoverServiceConfig {
    enabled: boolean;
    autoFailover: boolean;
    failoverTimeout: number;
    recoveryTimeout: number;
    minReplicas: number;
    maxLagSeconds: number;
}
export declare class FailoverService {
    private mysqlProvider;
    private proxysqlProvider;
    private topologyService;
    private config;
    private state;
    private previousTopologies;
    constructor(config: FailoverServiceConfig);
    /**
     * Get current failover state
     */
    getState(): FailoverState;
    /**
     * Check if switchover is possible
     */
    canSwitchover(): Promise<SwitchoverCheck>;
    /**
     * Execute graceful switchover
     */
    switchover(target?: string): Promise<SwitchoverResult>;
    /**
     * Execute emergency failover
     */
    failover(): Promise<FailoverResult>;
    /**
     * Emergency promote a specific host
     */
    emergencyPromote(host: string, port?: number): Promise<PromoteResult>;
    /**
     * Rollback to previous topology
     */
    rollback(): Promise<RollbackResult>;
    /**
     * Validate current topology
     */
    validateTopology(): Promise<ValidationResult>;
    /**
     * Find and rank failover candidates
     */
    private findFailoverCandidates;
    /**
     * Save previous topology for potential rollback
     */
    private savePreviousTopology;
}
export declare function getFailoverService(config?: FailoverServiceConfig): FailoverService;
export declare function resetFailoverService(): void;
export {};
//# sourceMappingURL=failover.d.ts.map