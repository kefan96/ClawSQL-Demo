/**
 * SQL Service
 *
 * Provides SQL execution and schema introspection via ProxySQL.
 */

import type { RowDataPacket, FieldPacket } from 'mysql2/promise';
import mysql from 'mysql2/promise';
import type { SQLConfig, SchemaInfo, SQLExecutionResult, SQLExecutionOptions, TableInfo, ColumnInfo } from '../types/sql.js';
import { getLogger } from '../logger.js';

const log = getLogger('sql-service');

interface SQLServiceConfig extends SQLConfig {
  host: string;
  dataPort: number;
  user: string;
  password: string;
}

export class SQLService {
  private config: SQLServiceConfig;
  private pool: mysql.Pool | null = null;

  constructor(config: SQLServiceConfig) {
    this.config = config;
  }

  /**
   * Get or create the connection pool
   */
  private getPool(database?: string): mysql.Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        host: this.config.host,
        port: this.config.dataPort,
        user: this.config.user,
        password: this.config.password,
        database: database || 'information_schema',
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: 5000,
      });
      log.debug({ host: this.config.host, port: this.config.dataPort }, 'Created SQL data pool');
    }
    return this.pool;
  }

  /**
   * Execute a SQL query
   */
  async execute(
    sql: string,
    options: SQLExecutionOptions = {}
  ): Promise<SQLExecutionResult> {
    const startTime = Date.now();
    const timeout = options.timeout || this.config.timeout;
    const maxRows = options.maxRows || this.config.maxRows;

    try {
      const pool = this.getPool(options.database);

      // Create a connection for query with timeout
      const connection = await pool.getConnection();

      try {
        // Set timeout
        await connection.query(`SET SESSION max_execution_time = ${timeout}`);

        // Execute query
        const [rows, fields] = await connection.query<RowDataPacket[]>(sql);

        // Release connection back to pool
        connection.release();

        const columns = (fields as FieldPacket[]).map(f => f.name);
        const rowsArray = Array.isArray(rows) ? rows : [rows];

        // Apply row limit
        const limitedRows = rowsArray.slice(0, maxRows);
        const wasTruncated = rowsArray.length > maxRows;

        const result: SQLExecutionResult = {
          success: true,
          columns,
          rows: limitedRows as Record<string, unknown>[],
          rowCount: limitedRows.length,
          executionTime: Date.now() - startTime,
        };

        if (wasTruncated) {
          log.warn({ totalRows: rowsArray.length, maxRows }, 'Result truncated due to row limit');
        }

        return result;
      } catch (error) {
        connection.release();
        throw error;
      }
    } catch (error) {
      log.error({ error, sql }, 'SQL execution failed');
      return {
        success: false,
        rowCount: 0,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get database schema information
   */
  async getSchema(database?: string): Promise<SchemaInfo> {
    const pool = this.getPool(database);

    // Get current database name
    const [dbResult] = await pool.query<RowDataPacket[]>('SELECT DATABASE() as db');
    const dbName = database || (dbResult[0]?.db as string) || 'unknown';

    // Get tables
    const [tables] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME as name, TABLE_ROWS as rowCount
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [dbName]
    );

    // Get columns for each table
    const tableInfos: TableInfo[] = await Promise.all(
      (tables as RowDataPacket[]).map(async (table) => {
        const [columns] = await pool.query<RowDataPacket[]>(
          `SELECT
             COLUMN_NAME as name,
             COLUMN_TYPE as type,
             IS_NULLABLE = 'YES' as nullable,
             COLUMN_KEY as \`key\`,
             COLUMN_DEFAULT as defaultValue,
             EXTRA as extra
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
           ORDER BY ORDINAL_POSITION`,
          [dbName, table.name]
        );

        return {
          name: table.name as string,
          schema: dbName,
          columns: (columns as RowDataPacket[]).map((col): ColumnInfo => ({
            name: col.name as string,
            type: col.type as string,
            nullable: Boolean(col.nullable),
            key: col.key as ColumnInfo['key'],
            defaultValue: col.defaultValue as string | null,
            extra: col.extra as string | null,
          })),
          rowCount: table.rowCount as number | undefined,
        };
      })
    );

    return {
      database: dbName,
      tables: tableInfos,
    };
  }

  /**
   * List available databases
   */
  async listDatabases(): Promise<string[]> {
    const pool = this.getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT SCHEMA_NAME as name
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
       ORDER BY SCHEMA_NAME`
    );
    return (rows as RowDataPacket[]).map(r => r.name as string);
  }

  /**
   * Check if SQL is read-only
   */
  isReadOnly(sql: string): boolean {
    const normalized = sql.trim().toUpperCase();
    const readOnlyPatterns = [
      /^\s*SELECT\b/i,
      /^\s*SHOW\b/i,
      /^\s*DESCRIBE\b/i,
      /^\s*DESC\b/i,
      /^\s*EXPLAIN\b/i,
    ];
    return readOnlyPatterns.some(p => p.test(normalized));
  }

  /**
   * Validate SQL for safety
   */
  validateSQL(sql: string, allowDDL: boolean = false): { valid: boolean; reason?: string } {
    const normalized = sql.trim().toUpperCase();

    // Check for multiple statements (potential SQL injection)
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    if (statements.length > 1) {
      // Check if it's just trailing semicolon
      const secondStatement = statements[1];
      if (statements.length > 2 || (secondStatement && secondStatement.trim().length > 0)) {
        return { valid: false, reason: 'Multiple statements are not allowed' };
      }
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      { pattern: /;\s*DROP\s+/i, reason: 'DROP statements are not allowed' },
      { pattern: /;\s*GRANT\s+/i, reason: 'GRANT statements are not allowed' },
      { pattern: /;\s*REVOKE\s+/i, reason: 'REVOKE statements are not allowed' },
      { pattern: /INTO\s+OUTFILE/i, reason: 'INTO OUTFILE is not allowed' },
      { pattern: /INTO\s+DUMPFILE/i, reason: 'INTO DUMPFILE is not allowed' },
      { pattern: /LOAD\s+DATA/i, reason: 'LOAD DATA is not allowed' },
    ];

    for (const { pattern, reason } of dangerousPatterns) {
      if (pattern.test(sql)) {
        return { valid: false, reason };
      }
    }

    // Check DDL if not allowed
    if (!allowDDL) {
      const ddlPatterns = [
        { pattern: /^\s*CREATE\s+/i, reason: 'CREATE statements require allowDDL=true' },
        { pattern: /^\s*ALTER\s+/i, reason: 'ALTER statements require allowDDL=true' },
        { pattern: /^\s*DROP\s+/i, reason: 'DROP statements require allowDDL=true' },
        { pattern: /^\s*TRUNCATE\s+/i, reason: 'TRUNCATE statements require allowDDL=true' },
      ];

      for (const { pattern, reason } of ddlPatterns) {
        if (pattern.test(sql)) {
          return { valid: false, reason };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Close the connection pool
   */
  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      log.debug('Closed SQL data pool');
    }
  }
}

// Singleton instance
let _service: SQLService | null = null;

export function getSQLService(config?: SQLServiceConfig): SQLService {
  if (!_service && config) {
    _service = new SQLService(config);
  }
  if (!_service) {
    throw new Error('SQL service not initialized');
  }
  return _service;
}

export function resetSQLService(): void {
  _service = null;
}