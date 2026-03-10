/**
 * Memory Types
 *
 * Types for the RAG (Retrieval-Augmented Generation) system.
 * Supports hybrid storage with SQLite for query history and markdown for schema documentation.
 */

import { z } from 'zod';
import type { SchemaInfo, TableInfo } from './sql.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  storagePath: z.string().default('./data/memory'),
  schemaSyncInterval: z.number().int().positive().default(3600000), // 1 hour
  maxQueryHistory: z.number().int().positive().default(1000),
  feedbackLearning: z.boolean().default(true),
  confirmationThreshold: z.number().min(0).max(1).default(0.8),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ─── Query History (SQLite) ───────────────────────────────────────────────────

export type UserAction = 'confirmed' | 'corrected' | 'rejected';

export interface QueryHistoryRecord {
  id: string;
  timestamp: Date;
  cluster: string;
  database: string;
  naturalLanguage: string;
  generatedSQL: string;
  correctedSQL?: string;
  userAction: UserAction;
  confidence: number;
  explanation?: string;
}

export interface QueryHistoryFilters {
  cluster?: string;
  database?: string;
  userAction?: UserAction;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

// ─── Schema Checksums (SQLite) ────────────────────────────────────────────────

export interface SchemaChecksum {
  cluster: string;
  database: string;
  checksum: string;
  lastChecked: Date;
  lastChanged: Date;
}

// ─── Schema Documentation (Markdown) ──────────────────────────────────────────

export interface ColumnDocument {
  name: string;
  type: string;
  nullable: boolean;
  key?: 'PRI' | 'UNI' | 'MUL' | '';
  defaultValue?: string | null;
  description?: string;  // Human-written description
}

export interface TableDocument {
  name: string;
  description?: string;  // Human-written business context
  columns: ColumnDocument[];
  exampleQueries?: string[];  // Common query patterns
  businessNotes?: string;  // Additional business context
}

export interface SchemaDocument {
  database: string;
  cluster: string;
  generatedAt: Date;
  tables: TableDocument[];
  version: number;
}

// ─── RAG Context ──────────────────────────────────────────────────────────────

export interface SimilarQuery {
  id: string;
  naturalLanguage: string;
  sql: string;
  correctedSQL?: string;
  userAction: UserAction;
  similarity: number;  // 0-1 similarity score
}

export interface TableContext {
  table: string;
  description?: string;
  exampleQueries?: string[];
  businessNotes?: string;
}

export interface RAGContext {
  schema: SchemaInfo;
  similarQueries: SimilarQuery[];
  tableContexts: TableContext[];
  confidence: number;
}

// ─── Feedback Types ───────────────────────────────────────────────────────────

export const FeedbackRequestSchema = z.object({
  queryId: z.string().min(1),
  action: z.enum(['confirmed', 'corrected', 'rejected']),
  correctedSQL: z.string().optional(),
  comment: z.string().optional(),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export interface FeedbackRecord {
  id: string;
  queryId: string;
  action: UserAction;
  correctedSQL?: string;
  comment?: string;
  timestamp: Date;
}

// ─── Schema Change Detection ──────────────────────────────────────────────────

export interface SchemaChange {
  type: 'table_added' | 'table_removed' | 'table_modified' | 'column_added' | 'column_removed' | 'column_modified';
  database: string;
  table?: string;
  column?: string;
  oldValue?: string;
  newValue?: string;
}

export interface SchemaDiff {
  cluster: string;
  database: string;
  changes: SchemaChange[];
  oldChecksum: string;
  newChecksum: string;
  detectedAt: Date;
}

// ─── SQL Query Response with Query ID ─────────────────────────────────────────

export interface SQLQueryResponseWithId {
  queryId: string;
  sql: string;
  explanation: string;
  isSafe: boolean;
  warnings?: string[];
  confidence: number;
  requiresConfirmation: boolean;
  results?: {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  };
  executionTime?: number;
}

// ─── Memory Statistics ────────────────────────────────────────────────────────

export interface MemoryStats {
  totalQueries: number;
  confirmedQueries: number;
  correctedQueries: number;
  rejectedQueries: number;
  averageConfidence: number;
  schemasStored: number;
  lastSchemaSync?: Date;
}