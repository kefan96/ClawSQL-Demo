/**
 * Failover Service
 *
 * Handles graceful switchover and automatic failover
 * for MySQL clusters.
 */
import { getMySQLProvider } from '../providers/mysql.js';
import { getProxySQLProvider, Hostgroups } from '../providers/proxysql.js';
import { getTopologyService } from './topology.js';
import { getLogger } from '../logger.js';
const log = getLogger('failover-service');
export class FailoverService {
    mysqlProvider;
    proxysqlProvider;
    topologyService;
    config;
    state;
    previousTopologies = [];
    constructor(config) {
        this.config = config;
        this.mysqlProvider = getMySQLProvider();
        this.proxysqlProvider = getProxySQLProvider();
        this.topologyService = getTopologyService();
        this.state = {
            inProgress: false,
            type: null,
            startedAt: null,
            oldPrimary: null,
            targetPrimary: null,
            step: 'idle',
            error: null,
        };
    }
    // ─── State ────────────────────────────────────────────────────────────────
    /**
     * Get current failover state
     */
    getState() {
        return { ...this.state };
    }
    // ─── Switchover (Planned) ──────────────────────────────────────────────────
    /**
     * Check if switchover is possible
     */
    async canSwitchover() {
        const result = {
            canSwitchover: true,
            reasons: [],
            warnings: [],
            suggestedTarget: null,
        };
        try {
            const topology = this.topologyService.getTopology();
            // Check for primary
            if (!topology.primary) {
                result.canSwitchover = false;
                result.reasons.push('No primary detected');
                return result;
            }
            // Check for replicas
            if (topology.replicas.length === 0) {
                result.canSwitchover = false;
                result.reasons.push('No replicas available');
                return result;
            }
            // Check minimum replicas
            if (topology.replicas.length < this.config.minReplicas) {
                result.warnings.push(`Only ${topology.replicas.length} replica(s), recommended ${this.config.minReplicas}`);
            }
            // Check for problems
            const criticalProblems = topology.problems.filter(p => p.severity === 'critical' || p.type === 'broken_replication');
            if (criticalProblems.length > 0) {
                result.canSwitchover = false;
                result.reasons.push(`Critical problems: ${criticalProblems.map(p => p.message).join(', ')}`);
                return result;
            }
            // Find best candidate
            const candidates = await this.findFailoverCandidates(topology);
            if (candidates.length === 0) {
                result.canSwitchover = false;
                result.reasons.push('No healthy replica candidates');
                return result;
            }
            const bestCandidate = candidates[0];
            if (bestCandidate) {
                result.suggestedTarget = `${bestCandidate.host}:${bestCandidate.port}`;
            }
            // Check replication lag
            for (const replica of topology.replicas) {
                const replStatus = replica.replication;
                if (replStatus?.secondsBehindMaster && replStatus.secondsBehindMaster > this.config.maxLagSeconds) {
                    result.warnings.push(`${replica.host} has replication lag of ${replStatus.secondsBehindMaster}s`);
                }
            }
        }
        catch (error) {
            result.canSwitchover = false;
            result.reasons.push(`Error: ${error}`);
        }
        return result;
    }
    /**
     * Execute graceful switchover
     */
    async switchover(target) {
        const startTime = Date.now();
        // Check if already in progress
        if (this.state.inProgress) {
            return {
                success: false,
                oldPrimary: '',
                newPrimary: '',
                duration: 0,
                message: 'Failover already in progress',
                proxySQLUpdated: false,
                replicationReconfigured: false,
                timestamp: new Date(),
            };
        }
        // Update state
        this.state = {
            inProgress: true,
            type: 'switchover',
            startedAt: new Date(),
            oldPrimary: null,
            targetPrimary: target ?? null,
            step: 'checking',
            error: null,
        };
        try {
            // Pre-check
            const check = await this.canSwitchover();
            if (!check.canSwitchover) {
                throw new Error(`Cannot switchover: ${check.reasons.join(', ')}`);
            }
            const topology = this.topologyService.getTopology();
            const oldPrimary = topology.primary;
            if (!oldPrimary) {
                throw new Error('No primary found');
            }
            this.state.oldPrimary = `${oldPrimary.host}:${oldPrimary.port}`;
            // Determine target
            let targetInstance;
            if (target) {
                const [host, portStr] = target.split(':');
                const port = portStr ? parseInt(portStr, 10) : 3306;
                const found = topology.replicas.find(r => r.host === host && r.port === port);
                if (!found) {
                    throw new Error(`Target ${target} not found in replicas`);
                }
                targetInstance = found;
            }
            else {
                // Select best candidate
                const candidates = await this.findFailoverCandidates(topology);
                if (candidates.length === 0) {
                    throw new Error('No suitable replica candidates');
                }
                const bestCandidate = candidates[0];
                if (!bestCandidate) {
                    throw new Error('No suitable replica candidates');
                }
                const found = topology.replicas.find(r => r.host === bestCandidate.host && r.port === bestCandidate.port);
                if (!found) {
                    throw new Error('Selected candidate not found in replicas');
                }
                targetInstance = found;
            }
            this.state.targetPrimary = `${targetInstance.host}:${targetInstance.port}`;
            this.state.step = 'locking';
            // Save current topology for rollback
            this.savePreviousTopology(topology, 'switchover');
            // Step 1: Set primary read-only
            log.info({ host: oldPrimary.host }, 'Setting primary read-only');
            this.state.step = 'setting_readonly';
            await this.mysqlProvider.setReadOnly(oldPrimary.host, oldPrimary.port, true);
            // Step 2: Wait for target to catch up
            log.info({ target: targetInstance.host }, 'Waiting for target to catch up');
            this.state.step = 'catching_up';
            const primaryGTID = await this.mysqlProvider.getGTIDExecuted(oldPrimary.host, oldPrimary.port);
            const caughtUp = await this.mysqlProvider.waitForGTID(targetInstance.host, targetInstance.port, primaryGTID, this.config.failoverTimeout * 1000);
            if (!caughtUp) {
                throw new Error('Target failed to catch up within timeout');
            }
            // Step 3: Promote target to primary
            log.info({ target: targetInstance.host }, 'Promoting target to primary');
            this.state.step = 'promoting';
            await this.mysqlProvider.promoteToPrimary(targetInstance.host, targetInstance.port);
            // Step 4: Redirect other replicas to new primary
            log.info('Redirecting replicas to new primary');
            this.state.step = 'reconfiguring';
            for (const replica of topology.replicas) {
                if (replica.host === targetInstance.host && replica.port === targetInstance.port) {
                    continue; // Skip the new primary
                }
                try {
                    await this.mysqlProvider.setupReplication(replica.host, replica.port, targetInstance.host, targetInstance.port);
                }
                catch (error) {
                    log.warn({ replica: replica.host, error }, 'Failed to reconfigure replica');
                }
            }
            // Step 5: Update ProxySQL routing
            log.info('Updating ProxySQL routing');
            this.state.step = 'updating_routing';
            await this.proxysqlProvider.switchWriter(oldPrimary.host, oldPrimary.port, targetInstance.host, targetInstance.port);
            // Refresh topology
            this.state.step = 'refreshing';
            await this.topologyService.refreshTopology();
            // Success
            const duration = Date.now() - startTime;
            this.state.step = 'complete';
            log.info({ oldPrimary: oldPrimary.host, newPrimary: targetInstance.host, duration }, 'Switchover completed');
            return {
                success: true,
                oldPrimary: `${oldPrimary.host}:${oldPrimary.port}`,
                newPrimary: `${targetInstance.host}:${targetInstance.port}`,
                duration,
                message: `Switchover completed successfully`,
                proxySQLUpdated: true,
                replicationReconfigured: true,
                timestamp: new Date(),
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.state.error = message;
            this.state.step = 'failed';
            log.error({ error }, 'Switchover failed');
            return {
                success: false,
                oldPrimary: this.state.oldPrimary ?? '',
                newPrimary: this.state.targetPrimary ?? '',
                duration: Date.now() - startTime,
                message: `Switchover failed: ${message}`,
                proxySQLUpdated: false,
                replicationReconfigured: false,
                timestamp: new Date(),
            };
        }
        finally {
            this.state.inProgress = false;
        }
    }
    // ─── Failover (Unplanned) ──────────────────────────────────────────────────
    /**
     * Execute emergency failover
     */
    async failover() {
        const startTime = Date.now();
        if (this.state.inProgress) {
            return {
                success: false,
                oldPrimary: null,
                newPrimary: '',
                duration: 0,
                message: 'Failover already in progress',
                reason: 'concurrent_operation',
                proxySQLUpdated: false,
                replicationReconfigured: false,
                timestamp: new Date(),
            };
        }
        this.state = {
            inProgress: true,
            type: 'failover',
            startedAt: new Date(),
            oldPrimary: null,
            targetPrimary: null,
            step: 'detecting',
            error: null,
        };
        try {
            const topology = this.topologyService.getTopology();
            // Save previous state
            this.savePreviousTopology(topology, 'failover');
            // If primary exists, mark it as old primary
            if (topology.primary) {
                this.state.oldPrimary = `${topology.primary.host}:${topology.primary.port}`;
                // Verify it's actually down
                const isUp = await this.mysqlProvider.ping(topology.primary.host, topology.primary.port);
                if (isUp) {
                    log.warn('Primary appears to be up - consider switchover instead');
                }
            }
            // Find best candidate
            this.state.step = 'selecting';
            const candidates = await this.findFailoverCandidates(topology);
            if (candidates.length === 0) {
                throw new Error('No suitable failover candidates');
            }
            const newPrimary = candidates[0];
            if (!newPrimary) {
                throw new Error('No suitable failover candidates');
            }
            this.state.targetPrimary = `${newPrimary.host}:${newPrimary.port}`;
            log.info({ candidate: newPrimary.host }, 'Selected failover candidate');
            // Promote candidate
            this.state.step = 'promoting';
            await this.mysqlProvider.promoteToPrimary(newPrimary.host, newPrimary.port);
            // Reconfigure other replicas
            this.state.step = 'reconfiguring';
            for (const replica of topology.replicas) {
                if (replica.host === newPrimary.host && replica.port === newPrimary.port) {
                    continue;
                }
                try {
                    await this.mysqlProvider.setupReplication(replica.host, replica.port, newPrimary.host, newPrimary.port);
                }
                catch (error) {
                    log.warn({ replica: replica.host, error }, 'Failed to reconfigure replica');
                }
            }
            // Update ProxySQL
            this.state.step = 'updating_routing';
            try {
                // Remove old primary if it was in writers
                if (topology.primary) {
                    await this.proxysqlProvider.removeServer(topology.primary.host, topology.primary.port, Hostgroups.WRITER);
                }
                // Add new primary as writer
                await this.proxysqlProvider.addServer(Hostgroups.WRITER, newPrimary.host, newPrimary.port);
                // Add new primary to readers if not already
                await this.proxysqlProvider.addServer(Hostgroups.READER, newPrimary.host, newPrimary.port);
            }
            catch (error) {
                log.warn({ error }, 'ProxySQL update error');
            }
            // Refresh topology
            this.state.step = 'refreshing';
            await this.topologyService.refreshTopology();
            const duration = Date.now() - startTime;
            this.state.step = 'complete';
            log.info({ newPrimary: newPrimary.host, duration }, 'Failover completed');
            return {
                success: true,
                oldPrimary: this.state.oldPrimary,
                newPrimary: `${newPrimary.host}:${newPrimary.port}`,
                duration,
                message: 'Failover completed successfully',
                reason: 'primary_failure',
                proxySQLUpdated: true,
                replicationReconfigured: true,
                timestamp: new Date(),
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.state.error = message;
            this.state.step = 'failed';
            return {
                success: false,
                oldPrimary: this.state.oldPrimary,
                newPrimary: this.state.targetPrimary ?? '',
                duration: Date.now() - startTime,
                message: `Failover failed: ${message}`,
                reason: 'error',
                proxySQLUpdated: false,
                replicationReconfigured: false,
                timestamp: new Date(),
            };
        }
        finally {
            this.state.inProgress = false;
        }
    }
    /**
     * Emergency promote a specific host
     */
    async emergencyPromote(host, port = 3306) {
        try {
            const primary = this.topologyService.getPrimary();
            await this.mysqlProvider.promoteToPrimary(host, port);
            if (primary) {
                await this.proxysqlProvider.switchWriter(primary.host, primary.port, host, port);
            }
            return {
                success: true,
                host,
                port,
                message: `Emergency promotion of ${host}:${port} completed`,
                timestamp: new Date(),
            };
        }
        catch (error) {
            return {
                success: false,
                host,
                port,
                message: `Emergency promotion failed: ${error}`,
                timestamp: new Date(),
            };
        }
    }
    // ─── Rollback ──────────────────────────────────────────────────────────────
    /**
     * Rollback to previous topology
     */
    async rollback() {
        const previous = this.previousTopologies.pop();
        if (!previous) {
            return {
                success: false,
                restoredPrimary: '',
                message: 'No previous topology available for rollback',
                timestamp: new Date(),
            };
        }
        try {
            // This would require careful implementation
            // For now, just return a message
            return {
                success: false,
                restoredPrimary: previous.primary,
                message: 'Rollback requires manual intervention',
                timestamp: new Date(),
            };
        }
        catch (error) {
            return {
                success: false,
                restoredPrimary: '',
                message: `Rollback failed: ${error}`,
                timestamp: new Date(),
            };
        }
    }
    // ─── Validation ────────────────────────────────────────────────────────────
    /**
     * Validate current topology
     */
    async validateTopology() {
        const result = {
            valid: true,
            errors: [],
            warnings: [],
        };
        try {
            const topology = this.topologyService.getTopology();
            if (!topology.primary) {
                result.valid = false;
                result.errors.push('No primary detected');
            }
            if (topology.replicas.length === 0) {
                result.warnings.push('No replicas available');
            }
            for (const problem of topology.problems) {
                if (problem.severity === 'critical' || problem.severity === 'error') {
                    result.errors.push(problem.message);
                    result.valid = false;
                }
                else {
                    result.warnings.push(problem.message);
                }
            }
            // Verify ProxySQL sync
            const writers = await this.proxysqlProvider.getWriters();
            if (topology.primary) {
                const primaryAddr = `${topology.primary.host}:${topology.primary.port}`;
                const writerAddrs = writers.map(w => `${w.hostname}:${w.port}`);
                if (!writerAddrs.includes(primaryAddr)) {
                    result.warnings.push('ProxySQL writer does not match topology primary');
                }
            }
        }
        catch (error) {
            result.valid = false;
            result.errors.push(`Validation error: ${error}`);
        }
        return result;
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    /**
     * Find and rank failover candidates
     */
    async findFailoverCandidates(topology) {
        const candidates = [];
        for (const replica of topology.replicas) {
            try {
                const replStatus = await this.mysqlProvider.getReplicationStatus(replica.host, replica.port);
                const gtid = await this.mysqlProvider.getGTIDExecuted(replica.host, replica.port);
                const healthy = await this.mysqlProvider.ping(replica.host, replica.port);
                // Calculate score
                let score = 100;
                const reasons = [];
                if (!healthy) {
                    score = 0;
                    reasons.push('unreachable');
                }
                else {
                    // Penalize for replication lag
                    const lag = replStatus?.secondsBehindMaster ?? 999;
                    if (lag > this.config.maxLagSeconds) {
                        score -= 20;
                        reasons.push(`lag:${lag}s`);
                    }
                    // Bonus for running replication
                    if (replStatus?.ioThreadRunning && replStatus?.sqlThreadRunning) {
                        score += 10;
                    }
                    else {
                        score -= 30;
                        reasons.push('replication_stopped');
                    }
                }
                candidates.push({
                    host: replica.host,
                    port: replica.port,
                    score,
                    reasons,
                    gtidPosition: gtid,
                    lag: replStatus?.secondsBehindMaster ?? 999,
                    healthy,
                });
            }
            catch (error) {
                log.warn({ host: replica.host, error }, 'Failed to evaluate candidate');
            }
        }
        // Sort by score (descending)
        return candidates.sort((a, b) => b.score - a.score);
    }
    /**
     * Save previous topology for potential rollback
     */
    savePreviousTopology(topology, reason) {
        this.previousTopologies.push({
            primary: topology.primary ? `${topology.primary.host}:${topology.primary.port}` : '',
            replicas: topology.replicas.map(r => `${r.host}:${r.port}`),
            timestamp: new Date(),
            reason,
        });
        // Keep only last 5 topologies
        if (this.previousTopologies.length > 5) {
            this.previousTopologies.shift();
        }
    }
}
// Singleton instance
let _service = null;
export function getFailoverService(config) {
    if (!_service && config) {
        _service = new FailoverService(config);
    }
    if (!_service) {
        throw new Error('Failover service not initialized');
    }
    return _service;
}
export function resetFailoverService() {
    _service = null;
}
//# sourceMappingURL=failover.js.map