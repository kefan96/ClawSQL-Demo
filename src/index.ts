/**
 * ClawSQL Service Entry Point
 *
 * Starts the REST API server with all components initialized.
 */

import { loadConfig } from './config/index.js';
import { initLogger, getRootLogger } from './logger.js';
import { getMySQLProvider } from './providers/mysql.js';
import { getProxySQLProvider } from './providers/proxysql.js';
import { getAIProvider } from './providers/ai.js';
import { getTopologyService } from './services/topology.js';
import { getFailoverService } from './services/failover.js';
import { getHealthService } from './services/health.js';
import { registerEventHandlers } from './events/index.js';
import { getScheduler } from './scheduler/index.js';
import { startServer } from './api/server.js';

const log = getRootLogger().child({ name: 'main' });

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();

  // Initialize logger
  initLogger(config.logging);

  log.info('Starting ClawSQL service');

  // Initialize providers
  getMySQLProvider({
    user: config.mysql.user,
    password: config.mysql.password,
    connectionLimit: config.mysql.connectionPool,
    connectTimeout: config.mysql.connectTimeout,
  });

  getProxySQLProvider({
    host: config.proxysql.host,
    adminPort: config.proxysql.adminPort,
    dataPort: config.proxysql.dataPort,
    user: config.proxysql.user,
    password: config.proxysql.password,
    hostgroups: config.proxysql.hostgroups,
  });

  if (config.ai.apiKey) {
    getAIProvider(config.ai);
  }

  // Initialize services
  const topologyService = getTopologyService({
    clusterName: config.cluster.name,
    seeds: config.cluster.seeds,
    pollInterval: config.scheduler.topologyPollInterval,
  });

  getFailoverService({
    enabled: config.failover.enabled,
    autoFailover: config.failover.autoFailover,
    failoverTimeout: config.failover.failoverTimeout,
    recoveryTimeout: config.failover.recoveryTimeout,
    minReplicas: config.failover.minReplicas,
    maxLagSeconds: config.failover.maxLagSeconds,
  });

  const healthService = getHealthService();

  // Register event handlers
  registerEventHandlers();

  // Start scheduler
  const scheduler = getScheduler(
    config.scheduler,
    topologyService,
    healthService
  );
  scheduler.start();

  // Start API server
  const server = await startServer(config);

  log.info(`ClawSQL service running on http://${config.api.host}:${config.api.port}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);

    scheduler.stop();
    await server.close();

    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});