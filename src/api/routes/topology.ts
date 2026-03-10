/**
 * Topology API Routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getTopologyService } from '../../services/topology.js';

export async function topologyRoutes(fastify: FastifyInstance): Promise<void> {
  const topologyService = getTopologyService();

  // GET /api/topology - Current topology
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const topology = topologyService.getTopology();
      return {
        cluster: topology.clusterName,
        primary: topology.primary ? {
          host: topology.primary.host,
          port: topology.primary.port,
          serverId: topology.primary.serverId,
          version: topology.primary.version,
        } : null,
        replicas: topology.replicas.map(r => ({
          host: r.host,
          port: r.port,
          serverId: r.serverId,
          version: r.version,
          replicationLag: (r as { replication?: { secondsBehindMaster: number | null } }).replication?.secondsBehindMaster ?? null,
        })),
        problems: topology.problems.map(p => ({
          type: p.type,
          severity: p.severity,
          instance: p.instance,
          message: p.message,
        })),
        lastUpdated: topology.lastUpdated,
      };
    } catch (error) {
      return reply.code(503).send({
        error: 'Topology not available',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // POST /api/topology/discover - Trigger discovery
  fastify.post('/discover', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const topology = await topologyService.discoverCluster();
      return {
        success: true,
        message: 'Topology discovery completed',
        topology: {
          primary: topology.primary ? `${topology.primary.host}:${topology.primary.port}` : null,
          replicaCount: topology.replicas.length,
          problemCount: topology.problems.length,
        },
      };
    } catch (error) {
      return reply.code(500).send({
        error: 'Discovery failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // GET /api/topology/primary - Current primary
  fastify.get('/primary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const primary = topologyService.getPrimary();
      if (!primary) {
        return reply.code(404).send({ error: 'No primary detected' });
      }
      return {
        host: primary.host,
        port: primary.port,
        serverId: primary.serverId,
        version: primary.version,
        readOnly: primary.readOnly,
      };
    } catch (error) {
      return reply.code(503).send({
        error: 'Primary not available',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // GET /api/topology/replicas - All replicas
  fastify.get('/replicas', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const replicas = topologyService.getReplicas();
      return replicas.map(r => ({
        host: r.host,
        port: r.port,
        serverId: r.serverId,
        version: r.version,
        readOnly: r.readOnly,
        replicationLag: (r as { replication?: { secondsBehindMaster: number | null } }).replication?.secondsBehindMaster ?? null,
      }));
    } catch (error) {
      return reply.code(503).send({
        error: 'Replicas not available',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // GET /api/topology/problems - Current problems
  fastify.get('/problems', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const problems = topologyService.getProblems();
      return problems.map(p => ({
        type: p.type,
        severity: p.severity,
        instance: p.instance,
        message: p.message,
        detectedAt: p.detectedAt,
      }));
    } catch (error) {
      return reply.code(503).send({
        error: 'Problems not available',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}