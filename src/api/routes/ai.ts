/**
 * AI API Routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getAIProvider } from '../../providers/ai.js';
import { getTopologyService } from '../../services/topology.js';
import { getFailoverService } from '../../services/failover.js';

interface QueryBody {
  query: string;
}

interface AnalyzeBody {
  detailed?: boolean;
}

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/ai/analyze - Analyze topology
  fastify.post<{ Body: AnalyzeBody }>(
    '/analyze',
    async (request: FastifyRequest<{ Body: AnalyzeBody }>, reply: FastifyReply) => {
      try {
        const aiProvider = getAIProvider();
        const topologyService = getTopologyService();
        const topology = topologyService.getTopology();

        const analysis = await aiProvider.analyzeTopology(topology);

        return analysis;
      } catch (error) {
        return reply.code(500).send({
          error: 'Analysis failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/ai/recommend - Get failover recommendations
  fastify.post('/recommend', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const aiProvider = getAIProvider();
      const topologyService = getTopologyService();
      const topology = topologyService.getTopology();

      // Get candidates
      const candidates = [];
      for (const replica of topology.replicas) {
        candidates.push({
          host: replica.host,
          port: replica.port,
          score: 100,
          reasons: [],
          gtidPosition: '',
          lag: 0,
          healthy: true,
        });
      }

      const recommendation = await aiProvider.recommendFailover(topology, candidates);

      return recommendation;
    } catch (error) {
      return reply.code(500).send({
        error: 'Recommendation failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // POST /api/ai/query - Natural language query
  fastify.post<{ Body: QueryBody }>(
    '/query',
    async (request: FastifyRequest<{ Body: QueryBody }>, reply: FastifyReply) => {
      try {
        const { query } = request.body;

        if (!query) {
          return reply.code(400).send({ error: 'Query is required' });
        }

        const aiProvider = getAIProvider();
        const parsed = await aiProvider.parseCommand(query);

        // Execute the parsed command
        const topologyService = getTopologyService();
        const topology = topologyService.getTopology();

        let result: Record<string, unknown> = { parsed };

        switch (parsed.intent) {
          case 'status':
            result.response = {
              primary: topology.primary ? `${topology.primary.host}:${topology.primary.port}` : null,
              replicas: topology.replicas.length,
              problems: topology.problems.length,
            };
            break;

          case 'analyze':
            const analysis = await aiProvider.analyzeTopology(topology);
            result.response = analysis;
            break;

          case 'switchover':
            if (parsed.target) {
              result.response = {
                message: `To perform switchover to ${parsed.target}, use: POST /api/failover/switchover with {"target": "${parsed.target}"}`,
              };
            } else {
              result.response = {
                message: 'Please specify a target for switchover',
              };
            }
            break;

          case 'failover':
            result.response = {
              message: 'To perform emergency failover, use: POST /api/failover/failover',
            };
            break;

          default:
            result.response = {
              message: 'Could not understand the command. Try: "show topology", "analyze cluster", or "switch to <host>"',
            };
        }

        return result;
      } catch (error) {
        return reply.code(500).send({
          error: 'Query failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // POST /api/ai/report - Generate status report
  fastify.post('/report', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const aiProvider = getAIProvider();
      const topologyService = getTopologyService();
      const topology = topologyService.getTopology();

      const report = await aiProvider.generateReport(topology);

      return { report };
    } catch (error) {
      return reply.code(500).send({
        error: 'Report generation failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}