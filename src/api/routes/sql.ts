/**
 * SQL API Routes
 *
 * REST API endpoints for natural language to SQL feature.
 * Includes RAG-enhanced query generation with smart confirmation.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { getAIProvider } from '../../providers/ai.js';
import { getSQLService } from '../../services/sql.js';
import { getMemoryService } from '../../services/memory.js';
import { getConfig } from '../../config/index.js';
import type {
  SQLQueryRequest,
  SQLQueryResponse,
  SQLExecuteRequest,
  SQLExecuteResponse,
  SimilarQueryForContext,
  TableContextForSQL,
} from '../../types/sql.js';
import type { FeedbackRequest, SQLQueryResponseWithId } from '../../types/memory.js';
import { FeedbackRequestSchema } from '../../types/memory.js';
import { getLogger } from '../../logger.js';

const log = getLogger('sql-routes');

// Request schemas
const queryRequestSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string' },
    database: { type: 'string' },
    readOnly: { type: 'boolean', default: true },
  },
};

const executeRequestSchema = {
  type: 'object',
  required: ['sql'],
  properties: {
    sql: { type: 'string' },
    database: { type: 'string' },
  },
};

const feedbackRequestSchema = {
  type: 'object',
  required: ['queryId', 'action'],
  properties: {
    queryId: { type: 'string' },
    action: { type: 'string', enum: ['confirmed', 'corrected', 'rejected'] },
    correctedSQL: { type: 'string' },
    comment: { type: 'string' },
  },
};

export async function sqlRoutes(fastify: FastifyInstance): Promise<void> {
  const config = getConfig();

  /**
   * POST /api/sql/query - Natural language to SQL query with RAG
   */
  fastify.post<{ Body: SQLQueryRequest }>(
    '/query',
    {
      schema: {
        body: queryRequestSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              queryId: { type: 'string' },
              sql: { type: 'string' },
              explanation: { type: 'string' },
              isSafe: { type: 'boolean' },
              warnings: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number' },
              requiresConfirmation: { type: 'boolean' },
              results: {
                type: 'object',
                properties: {
                  columns: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array' },
                  rowCount: { type: 'number' },
                },
              },
              executionTime: { type: 'number' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: SQLQueryRequest }>, reply: FastifyReply) => {
      const { query, database, readOnly = true } = request.body;
      const queryId = `q-${randomUUID()}`;

      try {
        // Check if SQL feature is enabled
        if (!config.sql.enabled) {
          reply.code(403);
          return { error: 'SQL feature is disabled' };
        }

        const aiProvider = getAIProvider();
        const sqlService = getSQLService();

        // Initialize memory service if enabled
        let memoryService = null;
        let ragContext = null;

        if (config.memory.enabled) {
          try {
            memoryService = getMemoryService(config.memory);
            ragContext = await memoryService.buildRAGContext(
              query,
              database || 'default',
              config.cluster.name
            );
          } catch (error) {
            log.warn({ error }, 'Memory service not available, continuing without RAG');
          }
        }

        // Get schema for context if database specified
        let schema = ragContext?.schema;
        if (!schema && database) {
          try {
            schema = await sqlService.getSchema(database);
          } catch (error) {
            log.warn({ error, database }, 'Failed to get schema for context');
          }
        }

        // Build RAG context for AI
        const similarQueries: SimilarQueryForContext[] | undefined = ragContext?.similarQueries?.map(q => ({
          naturalLanguage: q.naturalLanguage,
          sql: q.sql,
          correctedSQL: q.correctedSQL,
          userAction: q.userAction,
        }));

        const tableContexts: TableContextForSQL[] | undefined = ragContext?.tableContexts?.map(ctx => ({
          table: ctx.table,
          description: ctx.description,
          exampleQueries: ctx.exampleQueries,
          businessNotes: ctx.businessNotes,
        }));

        // Generate SQL from natural language with RAG context
        const generated = await aiProvider.generateSQL({
          query,
          schema,
          database,
          readOnly,
          similarQueries,
          tableContexts,
        });

        // Get confidence from result
        const confidence = (generated as any).confidence || 0.7;

        // Validate generated SQL
        if (!generated.sql) {
          return {
            queryId,
            sql: '',
            explanation: generated.explanation,
            isSafe: false,
            confidence: 0,
            requiresConfirmation: false,
            warnings: generated.warnings,
          };
        }

        const validation = sqlService.validateSQL(generated.sql, !readOnly && config.sql.allowDDL);
        if (!validation.valid) {
          return {
            queryId,
            sql: generated.sql,
            explanation: generated.explanation,
            isSafe: false,
            confidence: 0,
            requiresConfirmation: false,
            warnings: [...(generated.warnings || []), validation.reason || 'SQL validation failed'],
          };
        }

        // Check read-only mode
        if (readOnly && !sqlService.isReadOnly(generated.sql)) {
          return {
            queryId,
            sql: generated.sql,
            explanation: generated.explanation,
            isSafe: false,
            confidence: 0,
            requiresConfirmation: false,
            warnings: [...(generated.warnings || []), 'Write operations not allowed in read-only mode'],
          };
        }

        // Determine if confirmation is needed (smart confirmation)
        const needsConfirmation =
          !generated.isSafe ||
          confidence < config.memory.confirmationThreshold ||
          !sqlService.isReadOnly(generated.sql);

        // Record query for history
        if (memoryService && config.memory.feedbackLearning) {
          await memoryService.recordQuery({
            id: queryId,
            timestamp: new Date(),
            cluster: config.cluster.name,
            database: database || 'default',
            naturalLanguage: query,
            generatedSQL: generated.sql,
            userAction: 'confirmed', // Default, will be updated by feedback
            confidence,
            explanation: generated.explanation,
          });
        }

        // If confirmation needed, return without executing
        if (needsConfirmation) {
          const response: SQLQueryResponseWithId = {
            queryId,
            sql: generated.sql,
            explanation: generated.explanation,
            isSafe: generated.isSafe,
            confidence,
            requiresConfirmation: true,
            warnings: generated.warnings,
          };
          return response;
        }

        // Execute the SQL immediately
        const result = await sqlService.execute(generated.sql, { database });

        const response: SQLQueryResponseWithId = {
          queryId,
          sql: generated.sql,
          explanation: generated.explanation,
          isSafe: result.success,
          confidence,
          requiresConfirmation: false,
          warnings: generated.warnings,
          results: result.success
            ? {
                columns: result.columns || [],
                rows: result.rows || [],
                rowCount: result.rowCount,
              }
            : undefined,
          executionTime: result.executionTime,
        };

        if (!result.success && result.error) {
          response.warnings = [...(response.warnings || []), result.error];
        }

        return response;
      } catch (error) {
        log.error({ error, query }, 'SQL query failed');
        reply.code(500);
        return {
          queryId,
          sql: '',
          explanation: 'Failed to process query',
          isSafe: false,
          confidence: 0,
          requiresConfirmation: false,
          warnings: [error instanceof Error ? error.message : 'Unknown error'],
        };
      }
    }
  );

  /**
   * POST /api/sql/feedback - Record user feedback on generated SQL
   */
  fastify.post<{ Body: FeedbackRequest }>(
    '/feedback',
    {
      schema: {
        body: feedbackRequestSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: FeedbackRequest }>, reply: FastifyReply) => {
      const { queryId, action, correctedSQL, comment } = request.body;

      try {
        // Check if memory is enabled
        if (!config.memory.enabled || !config.memory.feedbackLearning) {
          reply.code(403);
          return { success: false, message: 'Feedback learning is disabled' };
        }

        const memoryService = getMemoryService(config.memory);

        await memoryService.recordFeedback({
          id: `fb-${randomUUID()}`,
          queryId,
          action,
          correctedSQL,
          comment,
          timestamp: new Date(),
        });

        log.info({ queryId, action }, 'Query feedback recorded');

        return {
          success: true,
          message: `Feedback '${action}' recorded for query ${queryId}`,
        };
      } catch (error) {
        log.error({ error, queryId }, 'Failed to record feedback');
        reply.code(500);
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to record feedback',
        };
      }
    }
  );

  /**
   * POST /api/sql/confirm - Confirm and execute a query that required confirmation
   */
  fastify.post<{ Body: { queryId: string; database?: string } }>(
    '/confirm',
    {
      schema: {
        body: {
          type: 'object',
          required: ['queryId'],
          properties: {
            queryId: { type: 'string' },
            database: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              columns: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array' },
              rowCount: { type: 'number' },
              executionTime: { type: 'number' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { queryId: string; database?: string } }>, reply: FastifyReply) => {
      const { queryId, database } = request.body;

      try {
        // This would need a query store to retrieve the SQL by queryId
        // For now, we'll return an error suggesting to re-submit
        reply.code(400);
        return {
          success: false,
          rowCount: 0,
          executionTime: 0,
          error: 'Query confirmation requires re-submitting the query with the same parameters',
        };
      } catch (error) {
        log.error({ error, queryId }, 'Query confirmation failed');
        reply.code(500);
        return {
          success: false,
          rowCount: 0,
          executionTime: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * POST /api/sql/execute - Direct SQL execution
   */
  fastify.post<{ Body: SQLExecuteRequest }>(
    '/execute',
    {
      schema: {
        body: executeRequestSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              columns: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array' },
              rowCount: { type: 'number' },
              executionTime: { type: 'number' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: SQLExecuteRequest }>, reply: FastifyReply) => {
      const { sql, database } = request.body;

      try {
        // Check if SQL feature is enabled
        if (!config.sql.enabled) {
          reply.code(403);
          return { success: false, rowCount: 0, executionTime: 0, error: 'SQL feature is disabled' };
        }

        const sqlService = getSQLService();

        // Validate SQL
        const isReadOnly = sqlService.isReadOnly(sql);
        if (config.sql.readOnlyByDefault && !isReadOnly) {
          reply.code(403);
          return {
            success: false,
            rowCount: 0,
            executionTime: 0,
            error: 'Write operations are disabled by default. Use the query endpoint with readOnly=false.',
          };
        }

        const validation = sqlService.validateSQL(sql, config.sql.allowDDL);
        if (!validation.valid) {
          reply.code(400);
          return {
            success: false,
            rowCount: 0,
            executionTime: 0,
            error: validation.reason,
          };
        }

        // Execute
        const result = await sqlService.execute(sql, { database });

        const response: SQLExecuteResponse = {
          success: result.success,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          executionTime: result.executionTime,
          error: result.error,
        };

        return response;
      } catch (error) {
        log.error({ error, sql }, 'SQL execution failed');
        reply.code(500);
        return {
          success: false,
          rowCount: 0,
          executionTime: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * GET /api/sql/schema - Get current database schema
   */
  fastify.get(
    '/schema',
    async (
      request: FastifyRequest<{ Querystring: { database?: string } }>,
      reply: FastifyReply
    ) => {
      const database = (request.query as { database?: string }).database;

      try {
        // Check if SQL feature is enabled
        if (!config.sql.enabled) {
          reply.code(403);
          return { error: 'SQL feature is disabled' };
        }

        const sqlService = getSQLService();
        const schema = await sqlService.getSchema(database);

        return schema;
      } catch (error) {
        log.error({ error, database }, 'Failed to get schema');
        reply.code(500);
        return { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  /**
   * GET /api/sql/databases - List available databases
   */
  fastify.get('/databases', async (request, reply) => {
    try {
      // Check if SQL feature is enabled
      if (!config.sql.enabled) {
        reply.code(403);
        return { error: 'SQL feature is disabled' };
      }

      const sqlService = getSQLService();
      const databases = await sqlService.listDatabases();

      return { databases };
    } catch (error) {
      log.error({ error }, 'Failed to list databases');
      reply.code(500);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * GET /api/sql/memory/stats - Get memory/RAG statistics
   */
  fastify.get('/memory/stats', async (request, reply) => {
    try {
      if (!config.memory.enabled) {
        reply.code(403);
        return { error: 'Memory feature is disabled' };
      }

      const memoryService = getMemoryService(config.memory);
      const stats = memoryService.getStats();

      return stats;
    } catch (error) {
      log.error({ error }, 'Failed to get memory stats');
      reply.code(500);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}