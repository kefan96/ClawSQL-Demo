/**
 * REST API Server
 *
 * Fastify-based REST API for ClawSQL.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '../types/config.js';
import { initLogger, getRootLogger } from '../logger.js';
import { topologyRoutes } from './routes/topology.js';
import { failoverRoutes } from './routes/failover.js';
import { routingRoutes } from './routes/routing.js';
import { healthRoutes } from './routes/health.js';
import { aiRoutes } from './routes/ai.js';

const log = getRootLogger().child({ name: 'api' });

interface APIServerOptions {
  port: number;
  host: string;
}

export async function createServer(config: Config): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.logging.level,
      transport: config.logging.format === 'pretty'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Register plugins
  await fastify.register(cors, {
    origin: true,
  });

  await fastify.register(websocket);

  // Health check endpoint
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // API info
  fastify.get('/api', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      name: 'ClawSQL API',
      version: '1.0.0',
      endpoints: [
        'GET  /api/topology - Current topology',
        'POST /api/topology/discover - Trigger discovery',
        'GET  /api/topology/primary - Current primary',
        'GET  /api/topology/replicas - All replicas',
        'POST /api/failover/switchover - Graceful switchover',
        'POST /api/failover/failover - Emergency failover',
        'POST /api/failover/rollback - Rollback to previous',
        'GET  /api/failover/status - Current failover state',
        'GET  /api/routing - Current routing',
        'PUT  /api/routing - Update routing',
        'POST /api/routing/sync - Sync with topology',
        'GET  /api/health - Overall health',
        'GET  /api/health/mysql - MySQL health',
        'GET  /api/health/replication - Replication status',
        'GET  /api/health/proxysql - ProxySQL health',
        'POST /api/ai/analyze - Analyze topology',
        'POST /api/ai/recommend - Get recommendations',
        'POST /api/ai/query - Natural language query',
      ],
    };
  });

  // Register routes
  await fastify.register(topologyRoutes, { prefix: '/api/topology' });
  await fastify.register(failoverRoutes, { prefix: '/api/failover' });
  await fastify.register(routingRoutes, { prefix: '/api/routing' });
  await fastify.register(healthRoutes, { prefix: '/api/health' });
  await fastify.register(aiRoutes, { prefix: '/api/ai' });

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    log.error({ error, url: request.url }, 'Request error');
    reply.code(500).send({
      error: error.message,
      statusCode: 500,
    });
  });

  return fastify;
}

export async function startServer(config: Config): Promise<FastifyInstance> {
  const fastify = await createServer(config);

  await fastify.listen({
    port: config.api.port,
    host: config.api.host,
  });

  log.info({ port: config.api.port, host: config.api.host }, 'API server started');

  return fastify;
}