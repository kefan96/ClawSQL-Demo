/**
 * Routing API Routes (ProxySQL)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getProxySQLProvider } from '../../providers/proxysql.js';

interface SyncBody {
  primary: string;
  replicas: string[];
  port?: number;
}

export async function routingRoutes(fastify: FastifyInstance): Promise<void> {
  const proxysqlProvider = getProxySQLProvider();

  // GET /api/routing - Current routing
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const servers = await proxysqlProvider.getServers();
      const poolStats = await proxysqlProvider.getPoolStats();

      return {
        servers: servers.map(s => ({
          hostgroup: s.hostgroupId,
          hostname: s.hostname,
          port: s.port,
          status: s.status,
          weight: s.weight,
          maxConnections: s.maxConnections,
        })),
        poolStats: poolStats.map(p => ({
          hostgroup: p.hostgroupId,
          server: `${p.srvHost}:${p.srvPort}`,
          status: p.status,
          connections: {
            used: p.connUsed,
            free: p.connFree,
            errors: p.connErr,
          },
          queries: p.queries,
          latencyUs: p.latencyUs,
        })),
      };
    } catch (error) {
      return reply.code(500).send({
        error: 'Failed to get routing',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // POST /api/routing/sync - Sync with topology
  fastify.post<{ Body: SyncBody }>(
    '/sync',
    async (request: FastifyRequest<{ Body: SyncBody }>, reply: FastifyReply) => {
      try {
        const { primary, replicas, port = 3306 } = request.body;

        const result = await proxysqlProvider.syncTopology(primary, replicas, port);

        return {
          message: result.success
            ? `Routing synced: ${result.added.length} added, ${result.removed.length} removed`
            : `Sync failed: ${result.errors.join(', ')}`,
          ...result,
        };
      } catch (error) {
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/routing/switch-writer - Switch writer
  fastify.post<{ Body: { oldHost: string; oldPort?: number; newHost: string; newPort?: number } }>(
    '/switch-writer',
    async (request: FastifyRequest<{ Body: { oldHost: string; oldPort?: number; newHost: string; newPort?: number } }>, reply: FastifyReply) => {
      try {
        const { oldHost, oldPort = 3306, newHost, newPort = 3306 } = request.body;

        await proxysqlProvider.switchWriter(oldHost, oldPort, newHost, newPort);

        return {
          success: true,
          message: `Writer switched from ${oldHost}:${oldPort} to ${newHost}:${newPort}`,
        };
      } catch (error) {
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/routing/add-server - Add server
  fastify.post<{ Body: { hostgroup: number; hostname: string; port?: number; weight?: number } }>(
    '/add-server',
    async (request: FastifyRequest<{ Body: { hostgroup: number; hostname: string; port?: number; weight?: number } }>, reply: FastifyReply) => {
      try {
        const { hostgroup, hostname, port = 3306, weight = 1000 } = request.body;

        await proxysqlProvider.addServer(hostgroup as 10 | 20 | 30, hostname, port, weight);

        return {
          success: true,
          message: `Server ${hostname}:${port} added to hostgroup ${hostgroup}`,
        };
      } catch (error) {
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // DELETE /api/routing/server - Remove server
  fastify.delete<{ Body: { hostname: string; port?: number; hostgroup?: number } }>(
    '/server',
    async (request: FastifyRequest<{ Body: { hostname: string; port?: number; hostgroup?: number } }>, reply: FastifyReply) => {
      try {
        const { hostname, port = 3306, hostgroup } = request.body;

        await proxysqlProvider.removeServer(hostname, port, hostgroup as 10 | 20 | 30 | undefined);

        return {
          success: true,
          message: `Server ${hostname}:${port} removed`,
        };
      } catch (error) {
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}