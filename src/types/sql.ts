/**
 * SQL Types
 *
 * Types for natural language to SQL feature.
 */

import { z } from 'zod';

// ─── SQL Configuration ───────────────────────────────────────────────────────

export const SQLConfigSchema = z.object({
  enabled: z.boolean().default(true),
  readOnlyByDefault: z.boolean().default(true),
  maxRows: z.number().int().positive().default(1000),
  timeout: z.number().int().positive().default(30000),
  allowDDL: z.boolean().default(false),
});

export type SQLConfig = z.infer<typeof SQLConfigSchema>;

// ─── Schema Information ───────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: 'PRI' | 'UNI' | 'MUL' | '' | null;
  defaultValue: string | null;
  extra: string | null;
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

export interface SchemaInfo {
  database: string;
  tables: TableInfo[];
}

// ─── SQL Generation ──────────────────────────────────────────────────────────

export interface SimilarQueryForContext {
  naturalLanguage: string;
  sql: string;
  correctedSQL?: string;
  userAction: string;
}

export interface TableContextForSQL {
  table: string;
  description?: string;
  exampleQueries?: string[];
  businessNotes?: string;
}

export interface SQLGenerationRequest {
  query: string;              // Natural language query
  schema?: SchemaInfo;        // Optional schema context
  database?: string;          // Target database
  readOnly?: boolean;         // Force read-only mode
  similarQueries?: SimilarQueryForContext[];  // RAG: Similar past queries
  tableContexts?: TableContextForSQL[];       // RAG: Business context for tables
}

export interface SQLGenerationResult {
  sql: string;                // Generated SQL
  explanation: string;        // Explanation of what the SQL does
  isSafe: boolean;            // Whether the SQL is safe to execute
  warnings?: string[];        // Any warnings about the generated SQL
}

// ─── SQL Execution ───────────────────────────────────────────────────────────

export interface SQLExecutionOptions {
  database?: string;          // Target database
  timeout?: number;           // Query timeout in ms
  maxRows?: number;           // Maximum rows to return
}

export interface SQLExecutionResult {
  success: boolean;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;      // milliseconds
  error?: string;
}

// ─── API Request/Response Types ──────────────────────────────────────────────

export const SQLQueryRequestSchema = z.object({
  query: z.string().min(1),
  database: z.string().optional(),
  readOnly: z.boolean().default(true),
});

export type SQLQueryRequest = z.infer<typeof SQLQueryRequestSchema>;

export const SQLExecuteRequestSchema = z.object({
  sql: z.string().min(1),
  database: z.string().optional(),
});

export type SQLExecuteRequest = z.infer<typeof SQLExecuteRequestSchema>;

export interface SQLQueryResponse {
  sql: string;
  explanation: string;
  isSafe: boolean;
  warnings?: string[];
  results?: {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
  };
  executionTime?: number;
}

export interface SQLExecuteResponse {
  success: boolean;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
  error?: string;
}

// ─── SQL Safety Check ────────────────────────────────────────────────────────

export type SQLStatementType =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'CREATE'
  | 'ALTER'
  | 'DROP'
  | 'TRUNCATE'
  | 'OTHER';

export interface SQLAnalysis {
  statementType: SQLStatementType;
  isReadOnly: boolean;
  isDDL: boolean;
  tables: string[];
  hasLimit: boolean;
  hasWhere: boolean;
}