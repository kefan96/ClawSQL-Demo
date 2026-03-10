/**
 * Scheduler
 *
 * Background task scheduling for health checks,
 * topology polling, replication monitoring, and schema sync.
 */
import { getMemoryService } from '../services/memory.js';
import { getSQLService } from '../services/sql.js';
import { getLogger } from '../logger.js';
const log = getLogger('scheduler');
export class Scheduler {
    config;
    options;
    topologyService;
    healthService;
    memoryService = null;
    intervals = new Map();
    running = false;
    constructor(config, topologyService, healthService, options) {
        this.config = config;
        this.options = options || {};
        this.topologyService = topologyService;
        this.healthService = healthService;
    }
    /**
     * Start all scheduled tasks
     */
    start() {
        if (this.running)
            return;
        this.running = true;
        log.info('Starting scheduler');
        // Initialize memory service if configured
        if (this.options.memoryConfig?.enabled) {
            try {
                this.memoryService = getMemoryService(this.options.memoryConfig);
            }
            catch (error) {
                log.warn({ error }, 'Memory service not available');
            }
        }
        // Topology polling
        this.schedule('topology-poll', this.config.topologyPollInterval, async () => {
            try {
                await this.topologyService.refreshTopology();
            }
            catch (error) {
                log.warn({ error }, 'Topology poll failed');
            }
        });
        // Health checks
        this.schedule('health-check', this.config.healthCheckInterval, async () => {
            try {
                const health = await this.healthService.getHealth();
                if (!health.healthy) {
                    log.warn({ components: health.components }, 'Health check failed');
                }
            }
            catch (error) {
                log.warn({ error }, 'Health check failed');
            }
        });
        // Replication monitoring
        this.schedule('replication-monitor', this.config.replicationMonitorInterval, async () => {
            try {
                const status = await this.healthService.getReplicationStatus();
                for (const replica of status.replicas) {
                    if (replica.lag !== null && replica.lag > 10) {
                        log.warn({ host: replica.host, lag: replica.lag }, 'High replication lag detected');
                    }
                }
            }
            catch (error) {
                log.warn({ error }, 'Replication monitor failed');
            }
        });
        // Schema sync task (if memory enabled)
        if (this.memoryService && this.config.schemaSyncInterval) {
            this.schedule('schema-sync', this.config.schemaSyncInterval, async () => {
                try {
                    await this.runSchemaSync();
                }
                catch (error) {
                    log.warn({ error }, 'Schema sync failed');
                }
            });
        }
        log.info('Scheduler started');
    }
    /**
     * Run schema sync for all registered databases
     */
    async runSchemaSync() {
        if (!this.memoryService || !this.options.clusterName) {
            return;
        }
        log.debug('Running schema sync task');
        try {
            const sqlService = getSQLService();
            const databases = await sqlService.listDatabases();
            for (const database of databases) {
                try {
                    const result = await this.memoryService.detectSchemaChanges(this.options.clusterName, database);
                    if (result.detected) {
                        log.info({ database, changes: result.changes.length }, 'Schema changes detected during sync');
                    }
                }
                catch (error) {
                    log.warn({ error, database }, 'Failed to sync schema for database');
                }
            }
        }
        catch (error) {
            log.error({ error }, 'Schema sync task failed');
        }
    }
    /**
     * Stop all scheduled tasks
     */
    stop() {
        if (!this.running)
            return;
        this.running = false;
        log.info('Stopping scheduler');
        for (const [name, interval] of this.intervals) {
            clearInterval(interval);
            log.debug({ name }, 'Stopped task');
        }
        this.intervals.clear();
        log.info('Scheduler stopped');
    }
    /**
     * Schedule a periodic task
     */
    schedule(name, intervalMs, task) {
        // Run immediately
        task().catch(err => log.warn({ err, name }, 'Initial task execution failed'));
        // Schedule periodic execution
        const handle = setInterval(() => {
            task().catch(err => log.warn({ err, name }, 'Task execution failed'));
        }, intervalMs);
        this.intervals.set(name, handle);
        log.debug({ name, intervalMs }, 'Task scheduled');
    }
    /**
     * Check if scheduler is running
     */
    isRunning() {
        return this.running;
    }
    /**
     * Trigger immediate schema sync
     */
    async triggerSchemaSync() {
        await this.runSchemaSync();
    }
}
// Singleton instance
let _scheduler = null;
export function getScheduler(config, topologyService, healthService, options) {
    if (!_scheduler && config && topologyService && healthService) {
        _scheduler = new Scheduler(config, topologyService, healthService, options);
    }
    if (!_scheduler) {
        throw new Error('Scheduler not initialized');
    }
    return _scheduler;
}
export function resetScheduler() {
    _scheduler = null;
}
//# sourceMappingURL=index.js.map