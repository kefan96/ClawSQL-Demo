/**
 * Memory Service
 *
 * High-level service for RAG (Retrieval-Augmented Generation) operations.
 * Combines schema storage, query history, and context building for AI.
 */

import { randomUUID } from 'crypto';
import { getMemoryStore } from '../memory/store.js';
import { getSQLService } from './sql.js';
import { getLogger } from '../logger.js';
import type { MemoryConfig } from '../types/memory.js';
import type { RAGContext, SimilarQuery, TableContext, QueryHistoryRecord, SchemaDiff, SchemaChange, FeedbackRecord, MemoryStats } from '../types/memory.js';
import type { SchemaInfo } from '../types/sql.js';
import type { ClusterEvent } from '../types/events.js';

const log = getLogger('memory-service');

export class MemoryService {
  private config: MemoryConfig;
  private eventHandler?: (event: ClusterEvent) => void;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  /**
   * Initialize the memory service
   */
  async initialize(): Promise<void> {
    const store = getMemoryStore(this.config);
    await store.initialize();
    log.info('Memory service initialized');
  }

  // ─── Schema Management ────────────────────────────────────────────────────

  /**
   * Capture and store schema for a database
   */
  async captureSchema(cluster: string, database: string): Promise<SchemaInfo | null> {
    try {
      const sqlService = getSQLService();
      const store = getMemoryStore(this.config);

      // Fetch current schema
      const schema = await sqlService.getSchema(database);

      // Compute checksum
      const checksum = store.computeChecksum(schema);

      // Check for changes
      const existing = store.getSchemaChecksum(cluster, database);
      const previousSchema = existing ? await store.getSchema(cluster, database) : null;

      if (previousSchema) {
        // Convert SchemaDocument to SchemaInfo for comparison
        const oldSchemaInfo: SchemaInfo = {
          database,
          tables: previousSchema.tables.map(t => ({
            name: t.name,
            schema: database,
            columns: t.columns.map(c => ({
              name: c.name,
              type: c.type,
              nullable: c.nullable,
              key: c.key || null,
              defaultValue: c.defaultValue || null,
              extra: null,
            })),
          })),
        };

        const changes = store.detectSchemaChanges(oldSchemaInfo, schema);

        if (changes.length > 0) {
          log.info({ cluster, database, changes: changes.length }, 'Schema changes detected');

          // Log changes
          store.logSchemaChanges(cluster, database, changes);

          // Emit event
          if (this.eventHandler) {
            this.eventHandler({
              id: `schema-${Date.now()}`,
              type: 'schema_change',
              timestamp: new Date(),
              cluster,
              details: { database, changes },
              message: `Schema changed in ${database}: ${changes.length} change(s)`,
              severity: 'info',
            });
          }
        }
      }

      // Save schema to markdown
      await store.saveSchema(cluster, database, schema);

      // Update checksum
      store.updateSchemaChecksum(cluster, database, checksum);

      log.debug({ cluster, database, tables: schema.tables.length }, 'Schema captured');
      return schema;
    } catch (error) {
      log.error({ error, cluster, database }, 'Failed to capture schema');
      return null;
    }
  }

  /**
   * Detect schema changes by comparing with stored version
   */
  async detectSchemaChanges(cluster: string, database: string): Promise<{
    detected: boolean;
    changes: SchemaChange[];
    diff?: SchemaDiff;
  }> {
    try {
      const sqlService = getSQLService();
      const store = getMemoryStore(this.config);

      // Get current schema
      const currentSchema = await sqlService.getSchema(database);
      const currentChecksum = store.computeChecksum(currentSchema);

      // Get stored checksum
      const stored = store.getSchemaChecksum(cluster, database);

      if (!stored) {
        // No previous schema, capture it
        await this.captureSchema(cluster, database);
        return { detected: false, changes: [] };
      }

      // Update last checked
      store.updateSchemaChecksum(cluster, database, stored.checksum);

      if (stored.checksum === currentChecksum) {
        return { detected: false, changes: [] };
      }

      // Schema changed - get old schema and compare
      const oldSchemaDoc = await store.getSchema(cluster, database);

      if (!oldSchemaDoc) {
        return { detected: true, changes: [], diff: undefined };
      }

      // Convert to SchemaInfo
      const oldSchema: SchemaInfo = {
        database,
        tables: oldSchemaDoc.tables.map(t => ({
          name: t.name,
          schema: database,
          columns: t.columns.map(c => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
            key: c.key || null,
            defaultValue: c.defaultValue || null,
            extra: null,
          })),
        })),
      };

      const changes = store.detectSchemaChanges(oldSchema, currentSchema);

      // Create diff
      const diff: SchemaDiff = {
        cluster,
        database,
        changes,
        oldChecksum: stored.checksum,
        newChecksum: currentChecksum,
        detectedAt: new Date(),
      };

      // Save new schema
      await store.saveSchema(cluster, database, currentSchema);
      store.updateSchemaChecksum(cluster, database, currentChecksum);
      store.logSchemaChanges(cluster, database, changes);

      return { detected: true, changes, diff };
    } catch (error) {
      log.error({ error, cluster, database }, 'Failed to detect schema changes');
      return { detected: false, changes: [] };
    }
  }

  /**
   * Get stored schema for a database
   */
  async getStoredSchema(cluster: string, database: string): Promise<SchemaInfo | null> {
    const store = getMemoryStore(this.config);
    const doc = await store.getSchema(cluster, database);

    if (!doc) return null;

    return {
      database: doc.database,
      tables: doc.tables.map(t => ({
        name: t.name,
        schema: doc.database,
        columns: t.columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          key: c.key || null,
          defaultValue: c.defaultValue || null,
          extra: null,
        })),
      })),
    };
  }

  // ─── RAG Context Building ─────────────────────────────────────────────────

  /**
   * Build RAG context for a query
   */
  async buildRAGContext(
    naturalLanguageQuery: string,
    database: string,
    cluster?: string
  ): Promise<RAGContext> {
    const store = getMemoryStore(this.config);
    const sqlService = getSQLService();

    // Get current schema (prefer live, fallback to stored)
    let schema: SchemaInfo;
    try {
      schema = await sqlService.getSchema(database);
    } catch {
      const stored = cluster ? await this.getStoredSchema(cluster, database) : null;
      if (!stored) {
        throw new Error(`Cannot get schema for database ${database}`);
      }
      schema = stored;
    }

    // Find similar past queries
    const similarQueries = this.config.feedbackLearning
      ? store.findSimilarQueries(naturalLanguageQuery, database, 5)
      : [];

    // Get table contexts
    const tableContexts: TableContext[] = [];
    if (cluster) {
      for (const table of schema.tables) {
        const tableDoc = await store.getTableContext(cluster, database, table.name);
        if (tableDoc && (tableDoc.description || tableDoc.exampleQueries?.length)) {
          tableContexts.push({
            table: table.name,
            description: tableDoc.description,
            exampleQueries: tableDoc.exampleQueries,
            businessNotes: tableDoc.businessNotes,
          });
        }
      }
    }

    // Calculate overall confidence based on context availability
    const confidence = this.calculateConfidence(schema, similarQueries, tableContexts);

    return {
      schema,
      similarQueries,
      tableContexts,
      confidence,
    };
  }

  /**
   * Calculate confidence score for RAG context
   */
  private calculateConfidence(
    schema: SchemaInfo,
    similarQueries: SimilarQuery[],
    tableContexts: TableContext[]
  ): number {
    let confidence = 0.5; // Base confidence

    // More tables = more context
    confidence += Math.min(schema.tables.length * 0.05, 0.2);

    // Similar queries with corrections help
    const correctedQueries = similarQueries.filter(q => q.correctedSQL);
    confidence += correctedQueries.length * 0.05;

    // Business context helps
    if (tableContexts.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Get context for a specific table
   */
  async getTableContext(
    cluster: string,
    database: string,
    tableName: string
  ): Promise<TableContext | null> {
    const store = getMemoryStore(this.config);
    const doc = await store.getTableContext(cluster, database, tableName);

    if (!doc) return null;

    return {
      table: doc.name,
      description: doc.description,
      exampleQueries: doc.exampleQueries,
      businessNotes: doc.businessNotes,
    };
  }

  // ─── Query Feedback ────────────────────────────────────────────────────────

  /**
   * Record feedback for a generated query
   */
  async recordFeedback(feedback: FeedbackRecord): Promise<void> {
    const store = getMemoryStore(this.config);

    // Get original query from history (if exists)
    const history = store.getQueryHistory({ limit: 100 });
    const existing = history.find(h => h.id === feedback.queryId);

    if (existing) {
      // Update existing record
      const record: QueryHistoryRecord = {
        ...existing,
        userAction: feedback.action,
        correctedSQL: feedback.correctedSQL,
      };
      store.recordQueryFeedback(record);
    } else {
      // Create new record (for queries not yet recorded)
      const record: QueryHistoryRecord = {
        id: feedback.queryId,
        timestamp: feedback.timestamp,
        cluster: '', // Will be empty for new records
        database: '',
        naturalLanguage: '',
        generatedSQL: '',
        correctedSQL: feedback.correctedSQL,
        userAction: feedback.action,
        confidence: 0.5,
        explanation: '',
      };
      store.recordQueryFeedback(record);
    }

    log.debug({ queryId: feedback.queryId, action: feedback.action }, 'Feedback recorded');
  }

  /**
   * Record a new query for history
   */
  async recordQuery(record: QueryHistoryRecord): Promise<string> {
    const store = getMemoryStore(this.config);

    if (!record.id) {
      record.id = `q-${randomUUID()}`;
    }

    store.recordQueryFeedback(record);
    return record.id;
  }

  // ─── Event Handling ─────────────────────────────────────────────────────────

  /**
   * Set event handler for schema changes
   */
  setEventHandler(handler: (event: ClusterEvent) => void): void {
    this.eventHandler = handler;
  }

  // ─── Statistics ─────────────────────────────────────────────────────────────

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const store = getMemoryStore(this.config);
    return store.getStats();
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  /**
   * Close the memory service
   */
  async close(): Promise<void> {
    const store = getMemoryStore(this.config);
    await store.close();
    log.info('Memory service closed');
  }
}

// Singleton instance
let _service: MemoryService | null = null;

export function getMemoryService(config?: MemoryConfig): MemoryService {
  if (!_service && config) {
    _service = new MemoryService(config);
  }
  if (!_service) {
    throw new Error('Memory service not initialized');
  }
  return _service;
}

export function resetMemoryService(): void {
  _service = null;
}