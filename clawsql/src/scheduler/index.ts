/**
 * Scheduler
 *
 * Background task scheduling for health checks,
 * topology polling, and replication monitoring.
 */

import type { TopologyService } from '../services/topology.js';
import type { HealthService } from '../services/health.js';
import { getLogger } from '../logger.js';

const log = getLogger('scheduler');

interface SchedulerConfig {
  topologyPollInterval: number;
  healthCheckInterval: number;
  replicationMonitorInterval: number;
}

export class Scheduler {
  private config: SchedulerConfig;
  private topologyService: TopologyService;
  private healthService: HealthService;
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  constructor(
    config: SchedulerConfig,
    topologyService: TopologyService,
    healthService: HealthService
  ) {
    this.config = config;
    this.topologyService = topologyService;
    this.healthService = healthService;
  }

  /**
   * Start all scheduled tasks
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    log.info('Starting scheduler');

    // Topology polling
    this.schedule('topology-poll', this.config.topologyPollInterval, async () => {
      try {
        await this.topologyService.refreshTopology();
      } catch (error) {
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
      } catch (error) {
        log.warn({ error }, 'Health check failed');
      }
    });

    // Replication monitoring
    this.schedule('replication-monitor', this.config.replicationMonitorInterval, async () => {
      try {
        const status = await this.healthService.getReplicationStatus();
        for (const replica of status.replicas) {
          if (replica.lag !== null && replica.lag > 10) {
            log.warn(
              { host: replica.host, lag: replica.lag },
              'High replication lag detected'
            );
          }
        }
      } catch (error) {
        log.warn({ error }, 'Replication monitor failed');
      }
    });

    log.info('Scheduler started');
  }

  /**
   * Stop all scheduled tasks
   */
  stop(): void {
    if (!this.running) return;

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
  private schedule(name: string, intervalMs: number, task: () => Promise<void>): void {
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
  isRunning(): boolean {
    return this.running;
  }
}

// Singleton instance
let _scheduler: Scheduler | null = null;

export function getScheduler(
  config?: SchedulerConfig,
  topologyService?: TopologyService,
  healthService?: HealthService
): Scheduler {
  if (!_scheduler && config && topologyService && healthService) {
    _scheduler = new Scheduler(config, topologyService, healthService);
  }
  if (!_scheduler) {
    throw new Error('Scheduler not initialized');
  }
  return _scheduler;
}

export function resetScheduler(): void {
  _scheduler = null;
}