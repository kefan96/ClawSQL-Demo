/**
 * Memory Store
 *
 * Hybrid storage implementation using SQLite for query history and
 * markdown files for schema documentation.
 */

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname } from 'path';
import { getLogger } from '../logger.js';
import type {
  MemoryConfig,
  QueryHistoryRecord,
  QueryHistoryFilters,
  SchemaChecksum,
  SchemaDocument,
  TableDocument,
  SimilarQuery,
  SchemaDiff,
  SchemaChange,
  MemoryStats,
} from '../types/memory.js';
import type { SchemaInfo, TableInfo } from '../types/sql.js';

const log = getLogger('memory-store');

// Use dynamic import for better-sqlite3 (ESM compatibility)
let Database: any = null;

async function loadDatabase(): Promise<any> {
  if (!Database) {
    const module = await import('better-sqlite3');
    Database = module.default;
  }
  return Database;
}

export class MemoryStore {
  private config: MemoryConfig;
  private db: any = null;
  private dbPath: string;
  private schemasPath: string;

  constructor(config: MemoryConfig) {
    this.config = config;
    this.dbPath = join(config.storagePath, 'memory.db');
    this.schemasPath = join(config.storagePath, 'schemas');
  }

  // ─── Initialization ──────────────────────────────────────────────────────

  /**
   * Initialize the memory store
   */
  async initialize(): Promise<void> {
    try {
      // Create directories
      await mkdir(dirname(this.dbPath), { recursive: true });
      await mkdir(this.schemasPath, { recursive: true });

      // Initialize SQLite database
      const DatabaseClass = await loadDatabase();
      this.db = new DatabaseClass(this.dbPath);

      // Create tables
      this.createTables();

      log.info({ dbPath: this.dbPath, schemasPath: this.schemasPath }, 'Memory store initialized');
    } catch (error) {
      log.error({ error }, 'Failed to initialize memory store');
      throw error;
    }
  }

  /**
   * Create SQLite tables
   */
  private createTables(): void {
    this.db.exec(`
      -- Query history table
      CREATE TABLE IF NOT EXISTS query_history (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        cluster TEXT NOT NULL,
        database TEXT NOT NULL,
        natural_language TEXT NOT NULL,
        generated_sql TEXT NOT NULL,
        corrected_sql TEXT,
        user_action TEXT NOT NULL,
        confidence REAL NOT NULL,
        explanation TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_query_history_database ON query_history(database);
      CREATE INDEX IF NOT EXISTS idx_query_history_timestamp ON query_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_query_history_action ON query_history(user_action);

      -- Schema checksums table
      CREATE TABLE IF NOT EXISTS schema_checksums (
        cluster TEXT NOT NULL,
        database TEXT NOT NULL,
        checksum TEXT NOT NULL,
        last_checked TEXT NOT NULL,
        last_changed TEXT NOT NULL,
        PRIMARY KEY (cluster, database)
      );

      -- Schema change log
      CREATE TABLE IF NOT EXISTS schema_change_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cluster TEXT NOT NULL,
        database TEXT NOT NULL,
        change_type TEXT NOT NULL,
        table_name TEXT,
        column_name TEXT,
        old_value TEXT,
        new_value TEXT,
        detected_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_schema_change_log_time ON schema_change_log(detected_at);
    `);
  }

  // ─── Schema Storage (Markdown) ────────────────────────────────────────────

  /**
   * Save schema to markdown files
   */
  async saveSchema(cluster: string, database: string, schema: SchemaInfo): Promise<void> {
    const clusterPath = join(this.schemasPath, this.sanitizeName(cluster));
    await mkdir(clusterPath, { recursive: true });

    // Generate schema document
    const document: SchemaDocument = {
      database,
      cluster,
      generatedAt: new Date(),
      tables: schema.tables.map(t => this.tableToDocument(t)),
      version: 1,
    };

    // Write main SCHEMA.md
    const schemaMdPath = join(clusterPath, 'SCHEMA.md');
    const schemaMd = this.renderSchemaMarkdown(document);
    await writeFile(schemaMdPath, schemaMd, 'utf-8');

    // Write individual table files
    for (const table of document.tables) {
      const tableMdPath = join(clusterPath, `${this.sanitizeName(table.name)}.md`);
      const tableMd = this.renderTableMarkdown(table, database, cluster);
      await writeFile(tableMdPath, tableMd, 'utf-8');
    }

    log.debug({ cluster, database, tableCount: schema.tables.length }, 'Schema saved to markdown');
  }

  /**
   * Get schema from markdown files
   */
  async getSchema(cluster: string, database: string): Promise<SchemaDocument | null> {
    const clusterPath = join(this.schemasPath, this.sanitizeName(cluster));
    const schemaMdPath = join(clusterPath, 'SCHEMA.md');

    try {
      await access(schemaMdPath, constants.R_OK);
      const content = await readFile(schemaMdPath, 'utf-8');
      return this.parseSchemaMarkdown(content, cluster, database);
    } catch {
      return null;
    }
  }

  /**
   * Get table-specific context
   */
  async getTableContext(cluster: string, database: string, tableName: string): Promise<TableDocument | null> {
    const clusterPath = join(this.schemasPath, this.sanitizeName(cluster));
    const tableMdPath = join(clusterPath, `${this.sanitizeName(tableName)}.md`);

    try {
      await access(tableMdPath, constants.R_OK);
      const content = await readFile(tableMdPath, 'utf-8');
      return this.parseTableMarkdown(content);
    } catch {
      return null;
    }
  }

  /**
   * Convert TableInfo to TableDocument
   */
  private tableToDocument(table: TableInfo): TableDocument {
    return {
      name: table.name,
      columns: table.columns.map(col => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        key: col.key || undefined,
        defaultValue: col.defaultValue,
      })),
    };
  }

  /**
   * Render schema as markdown
   */
  private renderSchemaMarkdown(doc: SchemaDocument): string {
    const lines: string[] = [
      `# Schema: ${doc.database}`,
      '',
      `**Cluster:** ${doc.cluster}`,
      `**Generated:** ${doc.generatedAt.toISOString()}`,
      `**Version:** ${doc.version}`,
      '',
      '## Tables',
      '',
    ];

    for (const table of doc.tables) {
      lines.push(`- [${table.name}](./${this.sanitizeName(table.name)}.md) - ${table.columns.length} columns`);
    }

    lines.push('');
    lines.push('---');
    lines.push('*This file is auto-generated. Do not edit directly.*');

    return lines.join('\n');
  }

  /**
   * Render table as markdown
   */
  private renderTableMarkdown(table: TableDocument, database: string, cluster: string): string {
    const lines: string[] = [
      `# Table: ${table.name}`,
      '',
      `**Database:** ${database}`,
      `**Cluster:** ${cluster}`,
      '',
      '## Columns',
      '',
      '| Column | Type | Nullable | Key | Default |',
      '|--------|------|----------|-----|---------|',
    ];

    for (const col of table.columns) {
      lines.push(
        `| ${col.name} | ${col.type} | ${col.nullable ? 'Yes' : 'No'} | ${col.key || '-'} | ${col.defaultValue || '-'} |`
      );
    }

    // Add sections for human-written context
    lines.push('');
    lines.push('## Description');
    lines.push('');
    lines.push(table.description || '*No description provided.*');
    lines.push('');
    lines.push('## Business Context');
    lines.push('');
    lines.push(table.businessNotes || '*No business context provided.*');
    lines.push('');
    lines.push('## Example Queries');
    lines.push('');

    if (table.exampleQueries && table.exampleQueries.length > 0) {
      for (const query of table.exampleQueries) {
        lines.push(`\`\`\`sql`);
        lines.push(query);
        lines.push(`\`\`\``);
        lines.push('');
      }
    } else {
      lines.push('*No example queries provided.*');
    }

    lines.push('---');
    lines.push('*Edit this file to add business context and examples.*');

    return lines.join('\n');
  }

  /**
   * Parse schema markdown file
   */
  private parseSchemaMarkdown(content: string, cluster: string, database: string): SchemaDocument {
    const lines = content.split('\n');
    const tables: TableDocument[] = [];

    let generatedAt = new Date();
    let version = 1;

    for (const line of lines) {
      if (line && line.startsWith('**Generated:**')) {
        const dateStr = line.split('**Generated:**')[1]?.trim();
        if (dateStr) {
          generatedAt = new Date(dateStr);
        }
      }
      if (line && line.startsWith('**Version:**')) {
        const versionStr = line.split('**Version:**')[1]?.trim();
        if (versionStr) {
          version = parseInt(versionStr, 10);
        }
      }
      if (line && line.match(/^\- \[.+\]\(.+\.md\)/)) {
        const match = line.match(/\[(.+)\]/);
        if (match && match[1]) {
          tables.push({ name: match[1], columns: [] });
        }
      }
    }

    return {
      database,
      cluster,
      generatedAt,
      tables,
      version,
    };
  }

  /**
   * Parse table markdown file
   */
  private parseTableMarkdown(content: string): TableDocument {
    const lines = content.split('\n');
    const table: TableDocument = { name: '', columns: [] };
    let inColumns = false;
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';

      // Extract table name from heading
      if (line.startsWith('# Table:')) {
        table.name = line.replace('# Table:', '').trim();
      }

      // Detect sections
      if (line.startsWith('## Columns')) {
        inColumns = true;
        currentSection = 'columns';
        continue;
      }
      if (line.startsWith('## Description')) {
        inColumns = false;
        currentSection = 'description';
        continue;
      }
      if (line.startsWith('## Business Context')) {
        currentSection = 'business';
        continue;
      }
      if (line.startsWith('## Example Queries')) {
        currentSection = 'examples';
        continue;
      }

      // Parse columns
      if (inColumns && line.startsWith('|') && !line.includes('Column') && !line.includes('----')) {
        const parts = line.split('|').filter(p => p.trim());
        if (parts.length >= 4) {
          const colName = parts[0]?.trim() || '';
          const colType = parts[1]?.trim() || '';
          const colNullable = parts[2]?.trim() === 'Yes';
          const colKey = parts[3]?.trim();
          const colDefault = parts[4]?.trim();

          table.columns.push({
            name: colName,
            type: colType,
            nullable: colNullable,
            key: colKey && colKey !== '-' ? colKey as any : undefined,
            defaultValue: colDefault && colDefault !== '-' ? colDefault : undefined,
          });
        }
      }

      // Parse description
      if (currentSection === 'description' && !line.startsWith('*') && !line.startsWith('##')) {
        if (!table.description) table.description = '';
        table.description += line + '\n';
      }

      // Parse business context
      if (currentSection === 'business' && !line.startsWith('*') && !line.startsWith('##')) {
        if (!table.businessNotes) table.businessNotes = '';
        table.businessNotes += line + '\n';
      }
    }

    // Clean up whitespace
    table.description = table.description?.trim() || undefined;
    table.businessNotes = table.businessNotes?.trim() || undefined;

    return table;
  }

  // ─── Schema Checksums (SQLite) ─────────────────────────────────────────────

  /**
   * Compute checksum for schema
   */
  computeChecksum(schema: SchemaInfo): string {
    const content = JSON.stringify({
      database: schema.database,
      tables: schema.tables.map(t => ({
        name: t.name,
        columns: t.columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
        })),
      })),
    });
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get stored schema checksum
   */
  getSchemaChecksum(cluster: string, database: string): SchemaChecksum | null {
    const stmt = this.db.prepare(
      'SELECT * FROM schema_checksums WHERE cluster = ? AND database = ?'
    );
    const row = stmt.get(cluster, database);

    if (!row) return null;

    return {
      cluster: row.cluster,
      database: row.database,
      checksum: row.checksum,
      lastChecked: new Date(row.last_checked),
      lastChanged: new Date(row.last_changed),
    };
  }

  /**
   * Update schema checksum
   */
  updateSchemaChecksum(cluster: string, database: string, checksum: string): void {
    const now = new Date().toISOString();
    const existing = this.getSchemaChecksum(cluster, database);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE schema_checksums
        SET checksum = ?, last_checked = ?, last_changed = ?
        WHERE cluster = ? AND database = ?
      `);
      stmt.run(checksum, now, existing.checksum !== checksum ? now : existing.lastChanged, cluster, database);
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO schema_checksums (cluster, database, checksum, last_checked, last_changed)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(cluster, database, checksum, now, now);
    }
  }

  /**
   * Detect schema changes
   */
  detectSchemaChanges(oldSchema: SchemaInfo, newSchema: SchemaInfo): SchemaChange[] {
    const changes: SchemaChange[] = [];
    const oldTables = new Map(oldSchema.tables.map(t => [t.name, t]));
    const newTables = new Map(newSchema.tables.map(t => [t.name, t]));

    // Check for added/removed tables
    for (const [name] of newTables) {
      if (!oldTables.has(name)) {
        changes.push({
          type: 'table_added',
          database: newSchema.database,
          table: name,
        });
      }
    }

    for (const [name] of oldTables) {
      if (!newTables.has(name)) {
        changes.push({
          type: 'table_removed',
          database: newSchema.database,
          table: name,
        });
      }
    }

    // Check for column changes in existing tables
    for (const [name, newTable] of newTables) {
      const oldTable = oldTables.get(name);
      if (!oldTable) continue;

      const oldCols = new Map(oldTable.columns.map(c => [c.name, c]));
      const newCols = new Map(newTable.columns.map(c => [c.name, c]));

      for (const [colName] of newCols) {
        if (!oldCols.has(colName)) {
          changes.push({
            type: 'column_added',
            database: newSchema.database,
            table: name,
            column: colName,
          });
        }
      }

      for (const [colName] of oldCols) {
        if (!newCols.has(colName)) {
          changes.push({
            type: 'column_removed',
            database: newSchema.database,
            table: name,
            column: colName,
          });
        }
      }

      // Check for type changes
      for (const [colName, newCol] of newCols) {
        const oldCol = oldCols.get(colName);
        if (oldCol && oldCol.type !== newCol.type) {
          changes.push({
            type: 'column_modified',
            database: newSchema.database,
            table: name,
            column: colName,
            oldValue: oldCol.type,
            newValue: newCol.type,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Log schema changes
   */
  logSchemaChanges(cluster: string, database: string, changes: SchemaChange[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO schema_change_log
      (cluster, database, change_type, table_name, column_name, old_value, new_value, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    for (const change of changes) {
      stmt.run(
        cluster,
        database,
        change.type,
        change.table || null,
        change.column || null,
        change.oldValue || null,
        change.newValue || null,
        now
      );
    }
  }

  // ─── Query History (SQLite) ────────────────────────────────────────────────

  /**
   * Record query feedback
   */
  recordQueryFeedback(record: QueryHistoryRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO query_history
      (id, timestamp, cluster, database, natural_language, generated_sql, corrected_sql, user_action, confidence, explanation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.timestamp.toISOString(),
      record.cluster,
      record.database,
      record.naturalLanguage,
      record.generatedSQL,
      record.correctedSQL || null,
      record.userAction,
      record.confidence,
      record.explanation || null
    );

    // Trim history if exceeds max
    this.trimQueryHistory();

    log.debug({ queryId: record.id, action: record.userAction }, 'Query feedback recorded');
  }

  /**
   * Find similar queries
   */
  findSimilarQueries(
    naturalLanguage: string,
    database: string,
    limit: number = 5
  ): SimilarQuery[] {
    // Simple keyword-based similarity for now
    // Could be enhanced with embeddings later
    const keywords = this.extractKeywords(naturalLanguage);

    const stmt = this.db.prepare(`
      SELECT * FROM query_history
      WHERE database = ?
      ORDER BY timestamp DESC
      LIMIT 100
    `);

    const rows = stmt.all(database);

    // Calculate similarity scores
    const scored = rows
      .map((row: any) => {
        const rowKeywords = this.extractKeywords(row.natural_language);
        const similarity = this.calculateSimilarity(keywords, rowKeywords);
        return {
          id: row.id,
          naturalLanguage: row.natural_language,
          sql: row.generated_sql,
          correctedSQL: row.corrected_sql,
          userAction: row.user_action,
          similarity,
        };
      })
      .filter((s: SimilarQuery) => s.similarity > 0.1)
      .sort((a: SimilarQuery, b: SimilarQuery) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored;
  }

  /**
   * Get query history
   */
  getQueryHistory(filters: QueryHistoryFilters = {}): QueryHistoryRecord[] {
    let sql = 'SELECT * FROM query_history WHERE 1=1';
    const params: any[] = [];

    if (filters.cluster) {
      sql += ' AND cluster = ?';
      params.push(filters.cluster);
    }
    if (filters.database) {
      sql += ' AND database = ?';
      params.push(filters.database);
    }
    if (filters.userAction) {
      sql += ' AND user_action = ?';
      params.push(filters.userAction);
    }
    if (filters.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(filters.minConfidence);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    return rows.map((row: any): QueryHistoryRecord => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      cluster: row.cluster,
      database: row.database,
      naturalLanguage: row.natural_language,
      generatedSQL: row.generated_sql,
      correctedSQL: row.corrected_sql,
      userAction: row.user_action,
      confidence: row.confidence,
      explanation: row.explanation,
    }));
  }

  /**
   * Trim query history to max size
   */
  private trimQueryHistory(): void {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM query_history').get() as { count: number };

    if (count.count > this.config.maxQueryHistory) {
      const deleteCount = count.count - this.config.maxQueryHistory;
      this.db.prepare(`
        DELETE FROM query_history WHERE id IN (
          SELECT id FROM query_history ORDER BY timestamp ASC LIMIT ?
        )
      `).run(deleteCount);

      log.debug({ deleted: deleteCount }, 'Trimmed query history');
    }
  }

  // ─── Utility Methods ──────────────────────────────────────────────────────

  /**
   * Extract keywords from natural language
   */
  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'show', 'get', 'find', 'all', 'list',
      'what', 'which', 'where', 'when', 'how', 'is', 'are', 'was', 'were',
    ]);

    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word))
    );
  }

  /**
   * Calculate Jaccard similarity between keyword sets
   */
  private calculateSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Sanitize name for filesystem
   */
  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  // ─── Statistics ────────────────────────────────────────────────────────────

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const queryStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN user_action = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN user_action = 'corrected' THEN 1 ELSE 0 END) as corrected,
        SUM(CASE WHEN user_action = 'rejected' THEN 1 ELSE 0 END) as rejected,
        AVG(confidence) as avg_confidence
      FROM query_history
    `).get() as any;

    const schemaCount = this.db.prepare('SELECT COUNT(*) as count FROM schema_checksums').get() as { count: number };

    const lastSync = this.db.prepare('SELECT MAX(last_checked) as last FROM schema_checksums').get() as { last: string | null };

    return {
      totalQueries: queryStats.total || 0,
      confirmedQueries: queryStats.confirmed || 0,
      correctedQueries: queryStats.corrected || 0,
      rejectedQueries: queryStats.rejected || 0,
      averageConfidence: queryStats.avg_confidence || 0,
      schemasStored: schemaCount.count,
      lastSchemaSync: lastSync.last ? new Date(lastSync.last) : undefined,
    };
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      log.info('Memory store closed');
    }
  }
}

// Singleton instance
let _store: MemoryStore | null = null;

export function getMemoryStore(config?: MemoryConfig): MemoryStore {
  if (!_store && config) {
    _store = new MemoryStore(config);
  }
  if (!_store) {
    throw new Error('Memory store not initialized');
  }
  return _store;
}

export function resetMemoryStore(): void {
  _store = null;
}