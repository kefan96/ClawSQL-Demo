/**
 * Topology Service
 *
 * Core topology management for MySQL clusters.
 * Replaces Orchestrator's topology discovery and monitoring.
 */
import { getMySQLProvider } from '../providers/mysql.js';
import { getMemoryService } from './memory.js';
import { getSQLService } from './sql.js';
import { getLogger } from '../logger.js';
const log = getLogger('topology-service');
export class TopologyService {
    mysqlProvider;
    config;
    currentTopology = null;
    pollTimer = null;
    eventHandlers = new Map();
    previousTopology = null;
    constructor(config) {
        this.config = config;
        this.mysqlProvider = getMySQLProvider();
    }
    // ─── Discovery ──────────────────────────────────────────────────────────
    /**
     * Discover cluster topology from seed hosts
     */
    async discoverCluster() {
        log.info({ seeds: this.config.seeds }, 'Starting topology discovery');
        const instances = await this.mysqlProvider.discoverInstances(this.config.seeds);
        // Build topology
        const primary = instances.find(i => i.isPrimary) ?? null;
        const replicas = instances.filter(i => i.isReplica);
        // Get replication status for each instance
        const instancesWithRepl = await Promise.all(instances.map(async (instance) => {
            let replication = null;
            if (instance.isReplica) {
                replication = await this.mysqlProvider.getReplicationStatus(instance.host, instance.port);
            }
            return { ...instance, replication };
        }));
        // Detect problems
        const problems = this.detectProblems(primary, instancesWithRepl);
        const topology = {
            clusterName: this.config.clusterName,
            primary,
            replicas: instancesWithRepl.filter(i => i.isReplica),
            problems,
            lastUpdated: new Date(),
        };
        // Check for topology changes
        const diff = this.diffTopology(this.currentTopology, topology);
        if (diff && this.currentTopology) {
            this.emitTopologyChange(diff);
        }
        this.previousTopology = this.currentTopology;
        this.currentTopology = topology;
        log.info({
            primary: primary ? `${primary.host}:${primary.port}` : 'none',
            replicaCount: replicas.length,
            problems: problems.length,
        }, 'Topology discovered');
        // Auto-capture schema for discovered cluster (if memory enabled)
        if (primary && this.config.memoryConfig?.enabled) {
            this.captureSchemasInBackground().catch(err => {
                log.warn({ err }, 'Background schema capture failed');
            });
        }
        return topology;
    }
    /**
     * Capture schemas for all databases in background
     */
    async captureSchemasInBackground() {
        try {
            const memoryService = getMemoryService(this.config.memoryConfig);
            const sqlService = getSQLService();
            const databases = await sqlService.listDatabases();
            log.info({ databaseCount: databases.length }, 'Auto-capturing schemas for discovered cluster');
            for (const database of databases) {
                try {
                    await memoryService.captureSchema(this.config.clusterName, database);
                }
                catch (error) {
                    log.warn({ error, database }, 'Failed to capture schema');
                }
            }
            log.info({ databaseCount: databases.length }, 'Schema auto-capture completed');
        }
        catch (error) {
            log.error({ error }, 'Failed to auto-capture schemas');
        }
    }
    /**
     * Refresh topology (trigger immediate discovery)
     */
    async refreshTopology() {
        await this.discoverCluster();
    }
    // ─── Query ────────────────────────────────────────────────────────────────
    /**
     * Get current topology
     */
    getTopology() {
        if (!this.currentTopology) {
            throw new Error('Topology not yet discovered');
        }
        return this.currentTopology;
    }
    /**
     * Get current primary
     */
    getPrimary() {
        return this.currentTopology?.primary ?? null;
    }
    /**
     * Get all replicas
     */
    getReplicas() {
        return this.currentTopology?.replicas ?? [];
    }
    /**
     * Get current problems
     */
    getProblems() {
        return this.currentTopology?.problems ?? [];
    }
    /**
     * Get an instance by host:port
     */
    getInstance(host, port = 3306) {
        const topology = this.currentTopology;
        if (!topology)
            return undefined;
        if (topology.primary?.host === host && topology.primary.port === port) {
            // Return primary with null replication
            return { ...topology.primary, replication: null };
        }
        return topology.replicas.find(r => r.host === host && r.port === port);
    }
    // ─── Problem Detection ────────────────────────────────────────────────────
    /**
     * Detect problems in the topology
     */
    detectProblems(primary, instances) {
        const problems = [];
        const now = new Date();
        // No primary
        if (!primary) {
            problems.push({
                type: 'no_primary',
                severity: 'critical',
                instance: 'cluster',
                message: 'No primary detected in cluster',
                detectedAt: now,
            });
        }
        // Multi-master check (multiple non-read-only instances)
        const writableInstances = instances.filter(i => !i.readOnly && !i.isPrimary);
        if (writableInstances.length > 1) {
            problems.push({
                type: 'multi_master',
                severity: 'critical',
                instance: writableInstances.map(i => `${i.host}:${i.port}`).join(', '),
                message: 'Multiple writable instances detected - potential split-brain',
                detectedAt: now,
                details: { instances: writableInstances.map(i => i.host) },
            });
        }
        // Check each replica for replication issues
        for (const instance of instances) {
            if (!instance.isReplica || !instance.replication)
                continue;
            const repl = instance.replication;
            // Broken replication
            if (!repl.ioThreadRunning || !repl.sqlThreadRunning) {
                problems.push({
                    type: 'broken_replication',
                    severity: 'error',
                    instance: `${instance.host}:${instance.port}`,
                    message: `Replication threads stopped: IO=${repl.ioThreadRunning ? 'Yes' : 'No'}, SQL=${repl.sqlThreadRunning ? 'Yes' : 'No'}`,
                    detectedAt: now,
                    details: {
                        ioRunning: repl.ioThreadRunning,
                        sqlRunning: repl.sqlThreadRunning,
                    },
                });
            }
            // High replication lag
            if (repl.secondsBehindMaster !== null && repl.secondsBehindMaster > 5) {
                problems.push({
                    type: 'replication_lag',
                    severity: repl.secondsBehindMaster > 30 ? 'error' : 'warning',
                    instance: `${instance.host}:${instance.port}`,
                    message: `Replication lag: ${repl.secondsBehindMaster}s behind master`,
                    detectedAt: now,
                    details: { lag: repl.secondsBehindMaster },
                });
            }
        }
        // Orphaned replicas (not connected to current primary)
        if (primary) {
            for (const instance of instances) {
                if (!instance.isReplica || !instance.replication)
                    continue;
                const masterHost = instance.replication.masterHost;
                if (masterHost && masterHost !== primary.host) {
                    problems.push({
                        type: 'orphaned_replica',
                        severity: 'warning',
                        instance: `${instance.host}:${instance.port}`,
                        message: `Replica connected to wrong master: ${masterHost} (expected ${primary.host})`,
                        detectedAt: now,
                        details: { expectedMaster: primary.host, actualMaster: masterHost },
                    });
                }
            }
        }
        return problems;
    }
    // ─── Topology Diff ────────────────────────────────────────────────────────
    /**
     * Calculate difference between two topologies
     */
    diffTopology(oldTopo, newTopo) {
        if (!oldTopo)
            return null;
        const oldHosts = new Set([
            oldTopo.primary ? `${oldTopo.primary.host}:${oldTopo.primary.port}` : null,
            ...oldTopo.replicas.map(r => `${r.host}:${r.port}`),
        ].filter(Boolean));
        const newHosts = new Set([
            newTopo.primary ? `${newTopo.primary.host}:${newTopo.primary.port}` : null,
            ...newTopo.replicas.map(r => `${r.host}:${r.port}`),
        ].filter(Boolean));
        const added = [...newHosts].filter(h => !oldHosts.has(h));
        const removed = [...oldHosts].filter(h => !newHosts.has(h));
        const oldPrimary = oldTopo.primary ? `${oldTopo.primary.host}:${oldTopo.primary.port}` : null;
        const newPrimary = newTopo.primary ? `${newTopo.primary.host}:${newTopo.primary.port}` : null;
        const primaryChanged = oldPrimary !== newPrimary;
        // Only return a diff if there are actual changes
        if (added.length === 0 && removed.length === 0 && !primaryChanged) {
            return null;
        }
        return {
            added,
            removed,
            changed: [],
            primaryChanged,
            oldPrimary,
            newPrimary,
        };
    }
    // ─── Event Handling ────────────────────────────────────────────────────────
    /**
     * Emit a topology change event
     */
    emitTopologyChange(diff) {
        const event = {
            id: `topo-${Date.now()}`,
            type: 'topology_change',
            timestamp: new Date(),
            cluster: this.config.clusterName,
            details: { ...diff },
            message: diff.primaryChanged
                ? `Primary changed from ${diff.oldPrimary} to ${diff.newPrimary}`
                : `Topology changed: ${diff.added.length} added, ${diff.removed.length} removed`,
            severity: diff.primaryChanged ? 'warning' : 'info',
        };
        this.emit(event);
    }
    /**
     * Emit an event to handlers
     */
    emit(event) {
        const handlers = this.eventHandlers.get(event.type) ?? new Set();
        const wildcardHandlers = this.eventHandlers.get('*') ?? new Set();
        for (const handler of [...handlers, ...wildcardHandlers]) {
            try {
                handler(event);
            }
            catch (error) {
                log.error({ error, eventType: event.type }, 'Event handler error');
            }
        }
    }
    /**
     * Register an event handler
     */
    on(type, handler) {
        if (!this.eventHandlers.has(type)) {
            this.eventHandlers.set(type, new Set());
        }
        this.eventHandlers.get(type).add(handler);
    }
    /**
     * Remove an event handler
     */
    off(type, handler) {
        this.eventHandlers.get(type)?.delete(handler);
    }
    // ─── Polling ──────────────────────────────────────────────────────────────
    /**
     * Start periodic topology polling
     */
    startPolling(interval) {
        if (this.pollTimer) {
            this.stopPolling();
        }
        const pollInterval = interval ?? this.config.pollInterval;
        // Initial discovery
        this.discoverCluster().catch(err => {
            log.error({ err }, 'Initial topology discovery failed');
        });
        // Set up polling
        this.pollTimer = setInterval(() => {
            this.discoverCluster().catch(err => {
                log.error({ err }, 'Topology polling failed');
            });
        }, pollInterval);
        log.info({ interval: pollInterval }, 'Started topology polling');
    }
    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            log.info('Stopped topology polling');
        }
    }
    // ─── Cleanup ──────────────────────────────────────────────────────────────
    /**
     * Clean up resources
     */
    async destroy() {
        this.stopPolling();
        this.eventHandlers.clear();
        this.currentTopology = null;
    }
}
// Singleton instance
let _service = null;
export function getTopologyService(config) {
    if (!_service && config) {
        _service = new TopologyService(config);
    }
    if (!_service) {
        throw new Error('Topology service not initialized');
    }
    return _service;
}
export function resetTopologyService() {
    _service = null;
}
//# sourceMappingURL=topology.js.map