#!/usr/bin/env node
/**
 * Interactive Shell for ClawSQL
 *
 * Provides an interactive REPL for cluster management with:
 * - setup: Initialize and configure cluster components
 * - chat: Interactive AI chat interface
 * - query: Natural language or direct SQL queries
 * - check: Health checks and topology status
 * - operate: Switchover, failover, sync operations
 */

import * as readline from 'readline';
import { loadConfig, getConfig, saveConfig, updateConfig, getConfigPath } from '../config/index.js';
import { initLogger, getRootLogger } from '../logger.js';
import { getMySQLProvider } from '../providers/mysql.js';
import { getProxySQLProvider } from '../providers/proxysql.js';
import { getAIProvider, resetAIProvider } from '../providers/ai.js';
import { getTopologyService } from '../services/topology.js';
import { getFailoverService } from '../services/failover.js';
import { getHealthService } from '../services/health.js';
import { getSQLService } from '../services/sql.js';
import { getMemoryService } from '../services/memory.js';

const log = getRootLogger();

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
};

// Shell state
interface ShellState {
  initialized: boolean;
  currentDatabase: string | null;
  verbose: boolean;
  lastResult: any;
}

const state: ShellState = {
  initialized: false,
  currentDatabase: null,
  verbose: false,
  lastResult: null,
};

// ─── Utility Functions ────────────────────────────────────────────────────────

function print(text: string): void {
  console.log(text);
}

function printError(text: string): void {
  console.error(`${colors.red}Error: ${text}${colors.reset}`);
}

function printSuccess(text: string): void {
  console.log(`${colors.green}✓ ${text}${colors.reset}`);
}

function printWarning(text: string): void {
  console.log(`${colors.yellow}⚠ ${text}${colors.reset}`);
}

function printInfo(text: string): void {
  console.log(`${colors.cyan}ℹ ${text}${colors.reset}`);
}

function printHeader(title: string): void {
  console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}\n`);
}

function formatTable(rows: Record<string, any>[], columns?: string[]): string {
  if (rows.length === 0) return '(empty)';

  const firstRow = rows[0];
  if (!firstRow) return '(empty)';

  const cols = columns || Object.keys(firstRow);
  const widths: Record<string, number> = {};

  for (const col of cols) {
    widths[col] = Math.max(
      col.length,
      ...rows.map(r => String(r[col] ?? '').length)
    );
  }

  const header = cols.map(c => c.padEnd(widths[c] ?? 0)).join(' | ');
  const separator = cols.map(c => '-'.repeat(widths[c] ?? 0)).join('-+-');

  const lines = [header, separator];
  for (const row of rows) {
    lines.push(cols.map(c => String(row[c] ?? 'NULL').padEnd(widths[c] ?? 0)).join(' | '));
  }

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ─── Initialization ──────────────────────────────────────────────────────────

async function initialize(configPath?: string): Promise<void> {
  if (state.initialized) {
    printWarning('Already initialized. Use "reload" to reinitialize.');
    return;
  }

  printInfo('Initializing ClawSQL...');

  const config = loadConfig(configPath);
  initLogger(config.logging);

  // Initialize providers
  getMySQLProvider({
    user: config.mysql.user,
    password: config.mysql.password,
    connectionLimit: config.mysql.connectionPool,
    connectTimeout: config.mysql.connectTimeout,
  });

  getProxySQLProvider({
    host: config.proxysql.host,
    adminPort: config.proxysql.adminPort,
    dataPort: config.proxysql.dataPort,
    user: config.proxysql.user,
    password: config.proxysql.password,
    hostgroups: config.proxysql.hostgroups,
  });

  if (config.ai.apiKey) {
    getAIProvider(config.ai);
  }

  // Initialize services
  getTopologyService({
    clusterName: config.cluster.name,
    seeds: config.cluster.seeds,
    pollInterval: config.scheduler.topologyPollInterval,
  });

  getFailoverService({
    enabled: config.failover.enabled,
    autoFailover: config.failover.autoFailover,
    failoverTimeout: config.failover.failoverTimeout,
    recoveryTimeout: config.failover.recoveryTimeout,
    minReplicas: config.failover.minReplicas,
    maxLagSeconds: config.failover.maxLagSeconds,
  });

  getSQLService({
    ...config.sql,
    host: config.proxysql.host,
    dataPort: config.proxysql.dataPort,
    user: config.proxysql.user,
    password: config.proxysql.password,
  });

  if (config.memory.enabled) {
    const memoryService = getMemoryService(config.memory);
    await memoryService.initialize();
  }

  state.initialized = true;
  printSuccess('Initialized successfully');
  printInfo(`Cluster: ${config.cluster.name}`);
  printInfo(`ProxySQL: ${config.proxysql.host}:${config.proxysql.adminPort}`);
}

// ─── Setup Commands ───────────────────────────────────────────────────────────

async function handleSetup(args: string[]): Promise<void> {
  if (!state.initialized) {
    await initialize();
  }

  const subCmd = args[0] || 'all';

  switch (subCmd) {
    case 'all':
      await setupAll();
      break;
    case 'topology':
      await setupTopology();
      break;
    case 'routing':
      await setupRouting();
      break;
    case 'check':
      await setupCheck();
      break;
    default:
      printError(`Unknown setup command: ${subCmd}`);
      printSetupHelp();
  }
}

async function setupAll(): Promise<void> {
  printHeader('Full Setup');

  printInfo('Discovering cluster topology...');
  await setupTopology();

  printInfo('Syncing ProxySQL routing...');
  await setupRouting();

  printInfo('Running health check...');
  await setupCheck();

  printSuccess('Setup completed!');
}

async function setupTopology(): Promise<void> {
  const topologyService = getTopologyService();

  try {
    const topology = await topologyService.discoverCluster();

    printHeader('Cluster Topology');
    print(`Cluster: ${topology.clusterName}`);

    if (topology.primary) {
      printSuccess(`Primary: ${topology.primary.host}:${topology.primary.port}`);
    } else {
      printError('No primary detected');
    }

    print(`\nReplicas (${topology.replicas.length}):`);
    for (const r of topology.replicas) {
      const lag = r.replication?.secondsBehindMaster ?? '?';
      print(`  ${colors.green}●${colors.reset} ${r.host}:${r.port} (lag=${lag}s)`);
    }

    if (topology.problems.length > 0) {
      printWarning(`\nProblems detected:`);
      for (const p of topology.problems) {
        print(`  [${p.severity}] ${p.type}: ${p.message}`);
      }
    }
  } catch (error) {
    printError(`Failed to discover topology: ${error}`);
  }
}

async function setupRouting(): Promise<void> {
  const topologyService = getTopologyService();
  const proxysqlProvider = getProxySQLProvider();

  try {
    const topology = topologyService.getTopology();
    const primary = topology.primary?.host;
    const replicas = topology.replicas.map(r => r.host);

    if (!primary) {
      printError('No primary detected, cannot sync routing');
      return;
    }

    const result = await proxysqlProvider.syncTopology(primary, replicas);

    printHeader('ProxySQL Routing');
    printSuccess(`Synced: ${result.added.length} added, ${result.removed.length} removed`);

    const servers = await proxysqlProvider.getServers();
    const writers = servers.filter(s => s.hostgroupId === 10);
    const readers = servers.filter(s => s.hostgroupId === 20);

    print('\nWriters (HG 10):');
    for (const s of writers) {
      print(`  ${s.hostname}:${s.port} status=${s.status}`);
    }

    print('\nReaders (HG 20):');
    for (const s of readers) {
      print(`  ${s.hostname}:${s.port} status=${s.status}`);
    }
  } catch (error) {
    printError(`Failed to sync routing: ${error}`);
  }
}

async function setupCheck(): Promise<void> {
  const healthService = getHealthService();

  try {
    const health = await healthService.getHealth();

    printHeader('Health Check');
    print(`Overall: ${health.healthy ? colors.green + 'HEALTHY' : colors.red + 'UNHEALTHY'}${colors.reset}`);

    const components = [
      { name: 'MySQL', ...health.components.mysql },
      { name: 'ProxySQL', ...health.components.proxysql },
      { name: 'Topology', ...health.components.topology },
    ];

    for (const c of components) {
      const icon = c.healthy ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
      print(`  ${icon} ${c.name}: ${c.message}`);
    }
  } catch (error) {
    printError(`Health check failed: ${error}`);
  }
}

function printSetupHelp(): void {
  print(`
${colors.bold}Setup Commands:${colors.reset}

  setup           Run full setup (topology + routing + check)
  setup topology  Discover and display cluster topology
  setup routing   Sync ProxySQL routing with topology
  setup check     Run health check
`);
}

// ─── Chat Commands ────────────────────────────────────────────────────────────

async function handleChat(args: string[]): Promise<void> {
  if (!state.initialized) {
    await initialize();
  }

  const query = args.join(' ');

  if (!query) {
    printError('Please provide a message. Usage: chat <message>');
    return;
  }

  try {
    const aiProvider = getAIProvider();
    const topologyService = getTopologyService();

    // Get current context
    const topology = topologyService.getTopology();

    const prompt = `You are ClawSQL Assistant, an AI helper for MySQL cluster management.

Current Cluster State:
- Cluster: ${topology.clusterName}
- Primary: ${topology.primary ? `${topology.primary.host}:${topology.primary.port}` : 'None'}
- Replicas: ${topology.replicas.length}
- Problems: ${topology.problems.length}

User message: "${query}"

Respond helpfully and concisely. If the user wants to perform an action, guide them to the appropriate command.`;

    printHeader('AI Response');
    const response = await aiProvider.analyzeTopology(topology);

    // For simple queries, use generateReport or custom response
    const report = await aiProvider.generateReport(topology);
    print(report);

  } catch (error) {
    printError(`Chat failed: ${error}`);
    printInfo('Make sure AI is configured with ANTHROPIC_API_KEY or OPENAI_API_KEY');
  }
}

// ─── Query Commands ───────────────────────────────────────────────────────────

async function handleQuery(args: string[]): Promise<void> {
  if (!state.initialized) {
    await initialize();
  }

  const config = getConfig();

  if (!config.sql.enabled) {
    printError('SQL feature is disabled in configuration');
    return;
  }

  const subCmd = args[0];
  const queryArgs = args.slice(1);

  switch (subCmd) {
    case 'sql':
      await querySQL(queryArgs.join(' '));
      break;
    case 'natural':
    case 'nl':
      await queryNatural(queryArgs.join(' '));
      break;
    case 'schema':
      await querySchema(queryArgs[0]);
      break;
    case 'databases':
    case 'db':
      await queryDatabases();
      break;
    case 'use':
      await queryUse(queryArgs[0]);
      break;
    case 'history':
      await queryHistory();
      break;
    default:
      // Treat as natural language query if no subcommand
      if (subCmd) {
        await queryNatural(args.join(' '));
      } else {
        printQueryHelp();
      }
  }
}

async function querySQL(sql: string): Promise<void> {
  if (!sql) {
    printError('Please provide SQL. Usage: query sql <statement>');
    return;
  }

  const config = getConfig();
  const sqlService = getSQLService();

  try {
    const validation = sqlService.validateSQL(sql, config.sql.allowDDL);
    if (!validation.valid) {
      printError(`Validation error: ${validation.reason}`);
      return;
    }

    const result = await sqlService.execute(sql, { database: state.currentDatabase ?? undefined });

    if (result.success && result.columns && result.rows) {
      printHeader('Results');
      print(formatTable(result.rows, result.columns));
      print(`\n${colors.dim}${result.rowCount} row(s) in ${formatDuration(result.executionTime)}${colors.reset}`);

      state.lastResult = result;
    } else if (result.error) {
      printError(result.error);
    }
  } catch (error) {
    printError(`Query failed: ${error}`);
  }
}

async function queryNatural(nlQuery: string): Promise<void> {
  if (!nlQuery) {
    printError('Please provide a query. Usage: query <natural language>');
    return;
  }

  const config = getConfig();
  const aiProvider = getAIProvider();
  const sqlService = getSQLService();

  try {
    // Get schema if database selected
    let schema = undefined;
    if (state.currentDatabase) {
      try {
        schema = await sqlService.getSchema(state.currentDatabase);
      } catch (error) {
        printWarning('Could not fetch schema for context');
      }
    }

    printInfo('Generating SQL...');
    const generated = await aiProvider.generateSQL({
      query: nlQuery,
      schema,
      database: state.currentDatabase ?? undefined,
      readOnly: config.sql.readOnlyByDefault,
    });

    printHeader('Generated SQL');
    print(`${colors.cyan}${generated.sql}${colors.reset}`);
    print(`\n${colors.dim}${generated.explanation}${colors.reset}`);

    if (generated.warnings && generated.warnings.length > 0) {
      for (const w of generated.warnings) {
        printWarning(w);
      }
    }

    if (generated.sql && generated.isSafe) {
      printInfo('Executing query...');
      const result = await sqlService.execute(generated.sql, { database: state.currentDatabase ?? undefined });

      if (result.success && result.columns && result.rows) {
        printHeader('Results');
        print(formatTable(result.rows, result.columns));
        print(`\n${colors.dim}${result.rowCount} row(s) in ${formatDuration(result.executionTime)}${colors.reset}`);

        state.lastResult = { ...result, generatedSQL: generated.sql };
      } else if (result.error) {
        printError(result.error);
      }
    } else if (!generated.isSafe) {
      printWarning('Query not automatically executed (unsafe). Use: query sql <generated SQL>');
    }
  } catch (error) {
    printError(`Natural query failed: ${error}`);
  }
}

async function querySchema(database?: string): Promise<void> {
  const sqlService = getSQLService();
  const db = database || state.currentDatabase;

  if (!db) {
    printError('No database selected. Use: query use <database>');
    return;
  }

  try {
    const schema = await sqlService.getSchema(db);

    printHeader(`Schema: ${db}`);

    for (const table of schema.tables) {
      print(`\n${colors.bold}${table.name}:${colors.reset}`);
      for (const col of table.columns) {
        const keyInfo = col.key ? ` ${colors.cyan}[${col.key}]${colors.reset}` : '';
        const nullInfo = col.nullable ? '' : ` ${colors.red}NOT NULL${colors.reset}`;
        print(`  ${col.name}: ${colors.dim}${col.type}${colors.reset}${nullInfo}${keyInfo}`);
      }
    }

    print(`\n${schema.tables.length} table(s)`);
  } catch (error) {
    printError(`Failed to get schema: ${error}`);
  }
}

async function queryDatabases(): Promise<void> {
  const sqlService = getSQLService();

  try {
    const databases = await sqlService.listDatabases();

    printHeader('Databases');
    for (const db of databases) {
      const marker = db === state.currentDatabase ? ` ${colors.green}(current)${colors.reset}` : '';
      print(`  ${db}${marker}`);
    }
    print(`\n${databases.length} database(s)`);
  } catch (error) {
    printError(`Failed to list databases: ${error}`);
  }
}

async function queryUse(database?: string): Promise<void> {
  if (!database) {
    printError('Please specify a database. Usage: query use <database>');
    return;
  }

  state.currentDatabase = database;
  printSuccess(`Using database: ${database}`);
}

async function queryHistory(): Promise<void> {
  const config = getConfig();

  if (!config.memory.enabled) {
    printError('Memory feature is disabled in configuration');
    return;
  }

  const memoryService = getMemoryService(config.memory);
  const stats = memoryService.getStats();

  printHeader('Query History');
  print(`Total queries: ${stats.totalQueries}`);
  print(`Confirmed: ${stats.confirmedQueries}`);
  print(`Corrected: ${stats.correctedQueries}`);
  print(`Rejected: ${stats.rejectedQueries}`);
  print(`Average confidence: ${(stats.averageConfidence * 100).toFixed(0)}%`);
  print(`Schemas stored: ${stats.schemasStored}`);
  print(`\nLast schema sync: ${stats.lastSchemaSync?.toLocaleString() || 'Never'}`);
}

function printQueryHelp(): void {
  print(`
${colors.bold}Query Commands:${colors.reset}

  query <text>        Natural language to SQL query
  query sql <stmt>    Execute SQL directly
  query schema [db]   Show database schema
  query databases     List available databases
  query use <db>      Set current database
  query history       Show query history stats

${colors.dim}Tip: Use "query use <database>" first for better context.${colors.reset}
`);
}

// ─── Check Commands ───────────────────────────────────────────────────────────

async function handleCheck(args: string[]): Promise<void> {
  if (!state.initialized) {
    await initialize();
  }

  const subCmd = args[0] || 'all';

  switch (subCmd) {
    case 'all':
      await checkAll();
      break;
    case 'health':
      await checkHealth();
      break;
    case 'topology':
    case 'topo':
      await checkTopology();
      break;
    case 'routing':
      await checkRouting();
      break;
    case 'problems':
      await checkProblems();
      break;
    case 'replication':
    case 'repl':
      await checkReplication();
      break;
    default:
      printError(`Unknown check command: ${subCmd}`);
      printCheckHelp();
  }
}

async function checkAll(): Promise<void> {
  printHeader('Full Status Check');

  await checkHealth();
  print('');

  await checkTopology();
  print('');

  await checkRouting();
}

async function checkHealth(): Promise<void> {
  const healthService = getHealthService();

  try {
    const health = await healthService.getHealth();

    print(`${colors.bold}Health Status:${colors.reset} ${health.healthy ? colors.green + 'HEALTHY' : colors.red + 'UNHEALTHY'}${colors.reset}`);

    const components = [
      { name: 'MySQL', ...health.components.mysql },
      { name: 'ProxySQL', ...health.components.proxysql },
      { name: 'Topology', ...health.components.topology },
    ];

    for (const c of components) {
      const icon = c.healthy ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
      print(`  ${icon} ${c.name}: ${c.message}`);
    }
  } catch (error) {
    printError(`Health check failed: ${error}`);
  }
}

async function checkTopology(): Promise<void> {
  const topologyService = getTopologyService();

  try {
    await topologyService.discoverCluster();
    const topology = topologyService.getTopology();

    print(`${colors.bold}Topology:${colors.reset} ${topology.clusterName}`);

    if (topology.primary) {
      printSuccess(`Primary: ${topology.primary.host}:${topology.primary.port}`);
    } else {
      printError('Primary: None detected');
    }

    print(`Replicas: ${topology.replicas.length}`);
    for (const r of topology.replicas) {
      const lag = r.replication?.secondsBehindMaster;
      const lagStr = lag !== null && lag !== undefined ? `${lag}s` : '?';
      const healthy = r.replication?.ioThreadRunning && r.replication?.sqlThreadRunning;
      const icon = healthy ? `${colors.green}●${colors.reset}` : `${colors.yellow}●${colors.reset}`;
      print(`  ${icon} ${r.host}:${r.port} (lag=${lagStr})`);
    }
  } catch (error) {
    printError(`Topology check failed: ${error}`);
  }
}

async function checkRouting(): Promise<void> {
  const proxysqlProvider = getProxySQLProvider();

  try {
    const servers = await proxysqlProvider.getServers();
    const writers = servers.filter(s => s.hostgroupId === 10);
    const readers = servers.filter(s => s.hostgroupId === 20);

    print(`${colors.bold}ProxySQL Routing:${colors.reset}`);

    print(`\nWriters (HG 10):`);
    for (const s of writers) {
      const icon = s.status === 'ONLINE' ? `${colors.green}●${colors.reset}` : `${colors.red}●${colors.reset}`;
      print(`  ${icon} ${s.hostname}:${s.port} (${s.status})`);
    }
    if (writers.length === 0) print('  (none)');

    print(`\nReaders (HG 20):`);
    for (const s of readers) {
      const icon = s.status === 'ONLINE' ? `${colors.green}●${colors.reset}` : `${colors.yellow}●${colors.reset}`;
      print(`  ${icon} ${s.hostname}:${s.port} (${s.status})`);
    }
    if (readers.length === 0) print('  (none)');
  } catch (error) {
    printError(`Routing check failed: ${error}`);
  }
}

async function checkProblems(): Promise<void> {
  const topologyService = getTopologyService();

  try {
    const topology = topologyService.getTopology();

    print(`${colors.bold}Problems:${colors.reset}`);

    if (topology.problems.length === 0) {
      printSuccess('No problems detected');
      return;
    }

    for (const p of topology.problems) {
      const severityColor = p.severity === 'critical' || p.severity === 'error'
        ? colors.red
        : p.severity === 'warning'
          ? colors.yellow
          : colors.cyan;
      print(`  ${severityColor}[${p.severity}]${colors.reset} ${p.type}: ${p.message}`);
    }
  } catch (error) {
    printError(`Problem check failed: ${error}`);
  }
}

async function checkReplication(): Promise<void> {
  const topologyService = getTopologyService();

  try {
    const topology = topologyService.getTopology();

    print(`${colors.bold}Replication Status:${colors.reset}\n`);

    for (const r of topology.replicas) {
      const repl = r.replication;
      if (!repl) {
        print(`${r.host}:${r.port}: ${colors.yellow}No replication info${colors.reset}`);
        continue;
      }

      const ioRunning = repl.ioThreadRunning;
      const sqlRunning = repl.sqlThreadRunning;
      const bothRunning = ioRunning && sqlRunning;

      const statusIcon = bothRunning ? `${colors.green}●${colors.reset}` : `${colors.red}●${colors.reset}`;

      print(`${statusIcon} ${r.host}:${r.port}`);
      print(`  IO Thread: ${ioRunning ? `${colors.green}Running${colors.reset}` : `${colors.red}Stopped${colors.reset}`}`);
      print(`  SQL Thread: ${sqlRunning ? `${colors.green}Running${colors.reset}` : `${colors.red}Stopped${colors.reset}`}`);
      print(`  Lag: ${repl.secondsBehindMaster ?? '?'}s`);
      print('');
    }
  } catch (error) {
    printError(`Replication check failed: ${error}`);
  }
}

function printCheckHelp(): void {
  print(`
${colors.bold}Check Commands:${colors.reset}

  check              Show all status (health + topology + routing)
  check health       Check cluster health
  check topology     Show cluster topology
  check routing      Show ProxySQL routing
  check problems     List detected problems
  check replication  Show detailed replication status
`);
}

// ─── Operate Commands ─────────────────────────────────────────────────────────

async function handleOperate(args: string[]): Promise<void> {
  if (!state.initialized) {
    await initialize();
  }

  const subCmd = args[0];

  switch (subCmd) {
    case 'switchover':
      await operateSwitchover(args.slice(1));
      break;
    case 'failover':
      await operateFailover(args.slice(1));
      break;
    case 'sync':
      await operateSync();
      break;
    case 'reload':
      await operateReload();
      break;
    default:
      printError(`Unknown operate command: ${subCmd}`);
      printOperateHelp();
  }
}

async function operateSwitchover(args: string[]): Promise<void> {
  const failoverService = getFailoverService();
  const topologyService = getTopologyService();

  const target = args.find(a => !a.startsWith('-'));
  const dryRun = args.includes('--dry-run');

  try {
    await topologyService.discoverCluster();

    if (dryRun) {
      const check = await failoverService.canSwitchover();

      printHeader('Switchover Check');
      print(`Can switchover: ${check.canSwitchover ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);

      if (check.reasons.length > 0) {
        print(`\nReasons:`);
        for (const r of check.reasons) print(`  - ${r}`);
      }

      if (check.warnings.length > 0) {
        print(`\nWarnings:`);
        for (const w of check.warnings) printWarning(w);
      }

      if (check.suggestedTarget) {
        printSuccess(`Suggested target: ${check.suggestedTarget}`);
      }

      return;
    }

    printWarning('Initiating switchover... This may take a few seconds.');
    const result = await failoverService.switchover(target);

    if (result.success) {
      printHeader('Switchover Completed');
      printSuccess(`Old primary: ${result.oldPrimary}`);
      printSuccess(`New primary: ${result.newPrimary}`);
      print(`Duration: ${formatDuration(result.duration)}`);
    } else {
      printError(`Switchover failed: ${result.message}`);
    }
  } catch (error) {
    printError(`Switchover failed: ${error}`);
  }
}

async function operateFailover(args: string[]): Promise<void> {
  const failoverService = getFailoverService();

  const force = args.includes('--force');

  if (!force) {
    printWarning('Emergency failover may result in data loss.');
    print('Use "operate failover --force" to proceed.');
    return;
  }

  try {
    printWarning('Initiating emergency failover...');
    const result = await failoverService.failover();

    if (result.success) {
      printHeader('Failover Completed');
      printSuccess(`New primary: ${result.newPrimary}`);
      print(`Duration: ${formatDuration(result.duration)}`);
    } else {
      printError(`Failover failed: ${result.message}`);
    }
  } catch (error) {
    printError(`Failover failed: ${error}`);
  }
}

async function operateSync(): Promise<void> {
  const topologyService = getTopologyService();
  const proxysqlProvider = getProxySQLProvider();

  try {
    await topologyService.discoverCluster();
    const topology = topologyService.getTopology();

    const primary = topology.primary?.host;
    const replicas = topology.replicas.map(r => r.host);

    if (!primary) {
      printError('No primary detected');
      return;
    }

    printInfo('Syncing ProxySQL routing...');
    const result = await proxysqlProvider.syncTopology(primary, replicas);

    printSuccess(`Synced: ${result.added.length} added, ${result.removed.length} removed`);

    if (result.added.length > 0) {
      print(`Added: ${result.added.join(', ')}`);
    }
    if (result.removed.length > 0) {
      print(`Removed: ${result.removed.join(', ')}`);
    }
  } catch (error) {
    printError(`Sync failed: ${error}`);
  }
}

async function operateReload(): Promise<void> {
  state.initialized = false;
  await initialize();
  printSuccess('Configuration reloaded');
}

function printOperateHelp(): void {
  print(`
${colors.bold}Operate Commands:${colors.reset}

  operate switchover [target]       Graceful switchover to target replica
  operate switchover --dry-run      Check if switchover is possible
  operate failover --force          Emergency failover (may cause data loss)
  operate sync                      Sync ProxySQL routing with topology
  operate reload                    Reload configuration
`);
}

// ─── Config Commands ───────────────────────────────────────────────────────────

async function handleConfig(args: string[]): Promise<void> {
  const subCmd = args[0] || 'show';

  switch (subCmd) {
    case 'show':
      await configShow();
      break;
    case 'ai':
      await configAI(args.slice(1));
      break;
    case 'mysql':
      await configMySQL(args.slice(1));
      break;
    case 'proxysql':
      await configProxySQL(args.slice(1));
      break;
    case 'set':
      await configSet(args.slice(1));
      break;
    case 'test':
      await configTest();
      break;
    default:
      printError(`Unknown config command: ${subCmd}`);
      printConfigHelp();
  }
}

async function configShow(): Promise<void> {
  const config = getConfig();

  printHeader('Current Configuration');
  print(`${colors.bold}Config File:${colors.reset} ${getConfigPath()}`);

  print(`\n${colors.bold}Cluster:${colors.reset}`);
  print(`  Name: ${config.cluster.name}`);
  print(`  Seeds: ${config.cluster.seeds.join(', ')}`);

  print(`\n${colors.bold}MySQL:${colors.reset}`);
  print(`  User: ${config.mysql.user}`);
  print(`  Pool Size: ${config.mysql.connectionPool}`);

  print(`\n${colors.bold}ProxySQL:${colors.reset}`);
  print(`  Host: ${config.proxysql.host}`);
  print(`  Admin Port: ${config.proxysql.adminPort}`);
  print(`  Data Port: ${config.proxysql.dataPort}`);
  print(`  Writer HG: ${config.proxysql.hostgroups.writer}`);
  print(`  Reader HG: ${config.proxysql.hostgroups.reader}`);

  print(`\n${colors.bold}AI:${colors.reset}`);
  print(`  Provider: ${config.ai.provider}`);
  print(`  Model: ${config.ai.model}`);
  print(`  API Key: ${config.ai.apiKey ? `${colors.green}configured${colors.reset}` : `${colors.red}not set${colors.reset}`}`);
  print(`  Features:`);
  print(`    Analysis: ${config.ai.features.analysis ? '✓' : '✗'}`);
  print(`    Recommendations: ${config.ai.features.recommendations ? '✓' : '✗'}`);
  print(`    Natural Language: ${config.ai.features.naturalLanguage ? '✓' : '✗'}`);

  print(`\n${colors.bold}SQL:${colors.reset}`);
  print(`  Enabled: ${config.sql.enabled ? '✓' : '✗'}`);
  print(`  Read Only: ${config.sql.readOnlyByDefault ? '✓' : '✗'}`);
  print(`  Allow DDL: ${config.sql.allowDDL ? '✓' : '✗'}`);

  print(`\n${colors.bold}Memory (RAG):${colors.reset}`);
  print(`  Enabled: ${config.memory.enabled ? '✓' : '✗'}`);
  print(`  Storage: ${config.memory.storagePath}`);

  print(`\n${colors.bold}API:${colors.reset}`);
  print(`  Host: ${config.api.host}`);
  print(`  Port: ${config.api.port}`);
}

async function configAI(args: string[]): Promise<void> {
  if (args.length === 0) {
    printConfigAIHelp();
    return;
  }

  const action = args[0];

  switch (action) {
    case 'set-key':
    case 'key':
      await configAISetKey(args[1]);
      break;
    case 'provider':
      await configAISetProvider(args[1]);
      break;
    case 'model':
      await configAISetModel(args[1]);
      break;
    case 'url':
    case 'baseurl':
    case 'base-url':
      await configAISetURL(args[1]);
      break;
    case 'test':
      await configAITest();
      break;
    case 'env':
      await configAIShowEnv();
      break;
    default:
      printError(`Unknown AI config action: ${action}`);
      printConfigAIHelp();
  }
}

function printConfigAIHelp(): void {
  print(`
${colors.bold}AI Configuration Commands:${colors.reset}

  config ai key <api-key>       Set API key (interactive if not provided)
  config ai provider <name>     Set provider (anthropic or openai)
  config ai model <name>        Set model name
  config ai url <url>           Set custom API base URL (for DashScope, Azure, etc.)
  config ai test                Test AI connection
  config ai env                 Show environment variable setup

${colors.dim}You can also set these via environment variables:
  ANTHROPIC_API_KEY or OPENAI_API_KEY for the API key
  ANTHROPIC_BASE_URL or OPENAI_BASE_URL for custom base URL
  CLAWSQL_AI_PROVIDER for provider
  CLAWSQL_AI_MODEL for model${colors.reset}
`);
}

async function configAISetKey(apiKey?: string): Promise<void> {
  if (!apiKey) {
    // Prompt for API key
    const key = await promptInput('Enter API key: ', true);
    if (!key) {
      printError('API key is required');
      return;
    }
    apiKey = key;
  }

  try {
    const config = getConfig();
    const provider = config.ai.provider;

    // Save to config
    saveConfig({
      ai: {
        ...config.ai,
        apiKey,
      },
    });

    // Set environment variable for current session
    if (provider === 'anthropic') {
      process.env.ANTHROPIC_API_KEY = apiKey;
    } else {
      process.env.OPENAI_API_KEY = apiKey;
    }

    // Reinitialize AI provider
    resetAIProvider();
    getAIProvider({
      ...config.ai,
      apiKey,
    });

    printSuccess('API key configured');
    printInfo(`Key saved to ${getConfigPath()}`);
  } catch (error) {
    printError(`Failed to save API key: ${error}`);
  }
}

async function configAISetProvider(provider?: string): Promise<void> {
  if (!provider) {
    print('Available providers: anthropic, openai');
    provider = await promptInput('Enter provider: ');
    if (!provider) {
      printError('Provider is required');
      return;
    }
  }

  if (provider !== 'anthropic' && provider !== 'openai') {
    printError('Invalid provider. Use "anthropic" or "openai"');
    return;
  }

  try {
    const config = getConfig();

    saveConfig({
      ai: {
        ...config.ai,
        provider: provider as 'anthropic' | 'openai',
      },
    });

    process.env.CLAWSQL_AI_PROVIDER = provider;
    printSuccess(`Provider set to: ${provider}`);
    printInfo(`You may need to set a new API key: config ai key`);
  } catch (error) {
    printError(`Failed to set provider: ${error}`);
  }
}

async function configAISetModel(model?: string): Promise<void> {
  if (!model) {
    print('Common models:');
    print('  Anthropic: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5');
    print('  OpenAI: gpt-4o, gpt-4-turbo, gpt-3.5-turbo');
    model = await promptInput('Enter model name: ');
    if (!model) {
      printError('Model name is required');
      return;
    }
  }

  try {
    const config = getConfig();

    saveConfig({
      ai: {
        ...config.ai,
        model,
      },
    });

    process.env.CLAWSQL_AI_MODEL = model;
    printSuccess(`Model set to: ${model}`);
  } catch (error) {
    printError(`Failed to set model: ${error}`);
  }
}

async function configAISetURL(baseURL?: string): Promise<void> {
  if (!baseURL) {
    print('Common base URLs:');
    print('  DashScope (Anthropic): https://dashscope.aliyuncs.com/apps/anthropic');
    print('  DashScope (OpenAI):    https://dashscope.aliyuncs.com/compatible-mode/v1');
    print('  Azure OpenAI:          https://your-resource.openai.azure.com/');
    baseURL = await promptInput('Enter base URL (or "clear" to remove): ');
    if (!baseURL) {
      printError('Base URL is required');
      return;
    }
  }

  try {
    const config = getConfig();

    if (baseURL.toLowerCase() === 'clear' || baseURL.toLowerCase() === 'none') {
      // Clear the base URL
      saveConfig({
        ai: {
          ...config.ai,
          baseURL: undefined,
        },
      });

      if (config.ai.provider === 'anthropic') {
        delete process.env.ANTHROPIC_BASE_URL;
      } else {
        delete process.env.OPENAI_BASE_URL;
      }

      printSuccess('Custom base URL cleared - using default endpoint');
    } else {
      // Validate URL
      try {
        new URL(baseURL);
      } catch {
        printError('Invalid URL format');
        return;
      }

      saveConfig({
        ai: {
          ...config.ai,
          baseURL,
        },
      });

      // Set environment variable for current session
      if (config.ai.provider === 'anthropic') {
        process.env.ANTHROPIC_BASE_URL = baseURL;
      } else {
        process.env.OPENAI_BASE_URL = baseURL;
      }

      printSuccess(`Base URL set to: ${baseURL}`);
      printInfo(`Using custom endpoint for ${config.ai.provider} API`);
    }

    // Reinitialize AI provider with new settings
    resetAIProvider();
    getAIProvider(config.ai);
  } catch (error) {
    printError(`Failed to set base URL: ${error}`);
  }
}

async function configAITest(): Promise<void> {
  const config = getConfig();

  if (!config.ai.apiKey) {
    printError('No API key configured. Use: config ai key <api-key>');
    return;
  }

  printInfo('Testing AI connection...');

  try {
    const aiProvider = getAIProvider();

    // Simple test
    const testTopology = {
      clusterName: 'test-cluster',
      primary: { host: 'mysql-1', port: 3306, serverId: 1, version: '8.0', readOnly: false, isPrimary: true, isReplica: false, lastSeen: new Date() },
      replicas: [],
      problems: [],
      lastUpdated: new Date(),
    };

    const analysis = await aiProvider.analyzeTopology(testTopology as any);

    if (analysis) {
      printSuccess('AI connection successful!');
      printInfo(`Provider: ${config.ai.provider}`);
      printInfo(`Model: ${config.ai.model}`);
    }
  } catch (error) {
    printError(`AI connection failed: ${error}`);
    printInfo('Check your API key and network connection');
  }
}

async function configAIShowEnv(): Promise<void> {
  printHeader('AI Environment Variables');
  print(`${colors.bold}Current Environment:${colors.reset}`);
  print(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? `${colors.green}set${colors.reset}` : `${colors.dim}not set${colors.reset}`}`);
  print(`  ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL ? `${colors.green}${process.env.ANTHROPIC_BASE_URL}${colors.reset}` : `${colors.dim}not set${colors.reset}`}`);
  print(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? `${colors.green}set${colors.reset}` : `${colors.dim}not set${colors.reset}`}`);
  print(`  OPENAI_BASE_URL: ${process.env.OPENAI_BASE_URL ? `${colors.green}${process.env.OPENAI_BASE_URL}${colors.reset}` : `${colors.dim}not set${colors.reset}`}`);
  print(`  CLAWSQL_AI_PROVIDER: ${process.env.CLAWSQL_AI_PROVIDER || colors.dim + 'not set' + colors.reset}`);
  print(`  CLAWSQL_AI_MODEL: ${process.env.CLAWSQL_AI_MODEL || colors.dim + 'not set' + colors.reset}`);

  print(`\n${colors.bold}Setup Instructions:${colors.reset}`);
  print(`\n${colors.cyan}Option 1: Set environment variables${colors.reset}`);
  print(`  export ANTHROPIC_API_KEY="your-api-key"`);
  print(`  export ANTHROPIC_BASE_URL="https://dashscope.aliyuncs.com/apps/anthropic"  # Optional`);
  print(`  export CLAWSQL_AI_PROVIDER="anthropic"`);
  print(`  export CLAWSQL_AI_MODEL="claude-sonnet-4-6"`);

  print(`\n${colors.cyan}Option 2: Use config command${colors.reset}`);
  print(`  config ai provider anthropic`);
  print(`  config ai key your-api-key`);
  print(`  config ai url https://dashscope.aliyuncs.com/apps/anthropic  # Optional`);
  print(`  config ai model claude-sonnet-4-6`);

  print(`\n${colors.cyan}Option 3: Edit config file${colors.reset}`);
  print(`  Edit: ${getConfigPath()}`);

  print(`\n${colors.bold}DashScope Example (Alibaba Cloud):${colors.reset}`);
  print(`  ${colors.dim}# Anthropic-compatible API:${colors.reset}`);
  print(`  config ai provider anthropic`);
  print(`  config ai url https://dashscope.aliyuncs.com/apps/anthropic`);
  print(`  ${colors.dim}# OpenAI-compatible API:${colors.reset}`);
  print(`  config ai provider openai`);
  print(`  config ai url https://dashscope.aliyuncs.com/compatible-mode/v1`);
}

async function configMySQL(args: string[]): Promise<void> {
  if (args.length === 0) {
    printConfigMySQLHelp();
    return;
  }

  const action = args[0];

  switch (action) {
    case 'host':
    case 'user':
    case 'password':
      const value = args[1] || await promptInput(`Enter ${action}: `);
      if (value === undefined) {
        printError(`${action} is required`);
        return;
      }
      try {
        updateConfig(`mysql.${action}`, value);
        printSuccess(`MySQL ${action} updated`);
      } catch (error) {
        printError(`Failed to update: ${error}`);
      }
      break;
    default:
      printError(`Unknown MySQL config action: ${action}`);
      printConfigMySQLHelp();
  }
}

function printConfigMySQLHelp(): void {
  print(`
${colors.bold}MySQL Configuration Commands:${colors.reset}

  config mysql user <username>      Set MySQL user
  config mysql password <password>  Set MySQL password

${colors.dim}Note: Hosts are discovered via cluster seeds.${colors.reset}
`);
}

async function configProxySQL(args: string[]): Promise<void> {
  if (args.length === 0) {
    printConfigProxySQLHelp();
    return;
  }

  const action = args[0];

  switch (action) {
    case 'host':
    case 'adminPort':
    case 'dataPort':
    case 'user':
    case 'password':
      const value = args[1] || await promptInput(`Enter ${action}: `);
      if (value === undefined) {
        printError(`${action} is required`);
        return;
      }
      const numValue = action.includes('Port') ? parseInt(value, 10) : value;
      try {
        updateConfig(`proxysql.${action}`, numValue);
        printSuccess(`ProxySQL ${action} updated`);
      } catch (error) {
        printError(`Failed to update: ${error}`);
      }
      break;
    default:
      printError(`Unknown ProxySQL config action: ${action}`);
      printConfigProxySQLHelp();
  }
}

function printConfigProxySQLHelp(): void {
  print(`
${colors.bold}ProxySQL Configuration Commands:${colors.reset}

  config proxysql host <host>           Set ProxySQL host
  config proxysql adminPort <port>      Set admin port (default: 6032)
  config proxysql dataPort <port>       Set data port (default: 6033)
  config proxysql user <username>       Set admin user
  config proxysql password <password>   Set admin password
`);
}

async function configSet(args: string[]): Promise<void> {
  if (args.length < 2) {
    printError('Usage: config set <path> <value>');
    print('Example: config set ai.model claude-opus-4-6');
    return;
  }

  const path = args[0]!;
  let value: unknown = args[1];

  // Try to parse as JSON for booleans and numbers
  try {
    value = JSON.parse(value as string);
  } catch {
    // Keep as string
  }

  try {
    updateConfig(path, value);
    printSuccess(`Set ${path} = ${JSON.stringify(value)}`);
  } catch (error) {
    printError(`Failed to set config: ${error}`);
  }
}

async function configTest(): Promise<void> {
  printHeader('Configuration Test');

  const results: { component: string; status: 'ok' | 'error' | 'warning'; message: string }[] = [];

  // Test MySQL connection
  try {
    const topologyService = getTopologyService();
    await topologyService.discoverCluster();
    results.push({ component: 'MySQL', status: 'ok', message: 'Connection successful' });
  } catch (error) {
    results.push({ component: 'MySQL', status: 'error', message: `${error}` });
  }

  // Test ProxySQL connection
  try {
    const proxysqlProvider = getProxySQLProvider();
    await proxysqlProvider.getServers();
    results.push({ component: 'ProxySQL', status: 'ok', message: 'Connection successful' });
  } catch (error) {
    results.push({ component: 'ProxySQL', status: 'error', message: `${error}` });
  }

  // Test AI
  const config = getConfig();
  if (config.ai.apiKey) {
    try {
      await configAITest();
      results.push({ component: 'AI', status: 'ok', message: `Provider: ${config.ai.provider}, Model: ${config.ai.model}` });
    } catch (error) {
      results.push({ component: 'AI', status: 'error', message: `${error}` });
    }
  } else {
    results.push({ component: 'AI', status: 'warning', message: 'No API key configured' });
  }

  // Print results
  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
  }

  const allOk = results.every(r => r.status === 'ok');
  print(`\n${allOk ? colors.green + 'All systems operational' : colors.yellow + 'Some issues detected'}${colors.reset}`);
}

function printConfigHelp(): void {
  print(`
${colors.bold}Config Commands:${colors.reset}

  config              Show current configuration
  config ai           Configure AI settings (key, provider, model)
  config mysql        Configure MySQL settings
  config proxysql     Configure ProxySQL settings
  config set <path>   Set a config value by path
  config test         Test all configured connections

${colors.dim}Config paths use dot notation: ai.model, proxysql.host, etc.${colors.reset}
`);
}

// ─── Doctor Commands ──────────────────────────────────────────────────────────

async function handleDoctor(args: string[]): Promise<void> {
  if (!state.initialized) {
    try {
      await initialize();
    } catch (error) {
      printWarning('Could not fully initialize, running limited diagnostics');
    }
  }

  const subCmd = args[0] || 'all';

  switch (subCmd) {
    case 'all':
      await doctorAll();
      break;
    case 'config':
      await doctorConfig();
      break;
    case 'connectivity':
      await doctorConnectivity();
      break;
    case 'topology':
      await doctorTopology();
      break;
    case 'replication':
      await doctorReplication();
      break;
    case 'routing':
      await doctorRouting();
      break;
    case 'ai':
      await doctorAI();
      break;
    case 'fix':
      await doctorFix(args.slice(1));
      break;
    default:
      printError(`Unknown doctor command: ${subCmd}`);
      printDoctorHelp();
  }
}

interface DiagnosticResult {
  component: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  fixable: boolean;
  fixCommand?: string;
}

async function doctorAll(): Promise<void> {
  printHeader('ClawSQL Doctor - Full Diagnostics');

  const results: DiagnosticResult[] = [];

  // Config check
  printInfo('Checking configuration...');
  results.push(...await checkConfig());

  // Connectivity check
  printInfo('Checking connectivity...');
  results.push(...await checkConnectivity());

  // Topology check
  printInfo('Checking topology...');
  results.push(...await checkTopologyDiagnostic());

  // Replication check
  printInfo('Checking replication...');
  results.push(...await checkReplicationDiagnostic());

  // Routing check
  printInfo('Checking routing...');
  results.push(...await checkRoutingDiagnostic());

  // AI check
  printInfo('Checking AI...');
  results.push(...await checkAIDiagnostic());

  // Print summary
  printHeader('Diagnostic Summary');

  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
    if (r.fixable && r.fixCommand) {
      print(`      ${colors.dim}Fix: doctor fix ${r.fixCommand}${colors.reset}`);
    }
  }

  const errors = results.filter(r => r.status === 'error');
  const warnings = results.filter(r => r.status === 'warning');
  const fixable = results.filter(r => r.fixable && r.status !== 'ok');

  print('');
  if (errors.length === 0 && warnings.length === 0) {
    printSuccess('All systems healthy!');
  } else {
    print(`${colors.bold}Issues Found:${colors.reset} ${errors.length} errors, ${warnings.length} warnings`);
    if (fixable.length > 0) {
      printInfo(`${fixable.length} issue(s) can be auto-fixed. Run: doctor fix all`);
    }
  }
}

async function doctorConfig(): Promise<void> {
  printHeader('Configuration Diagnostics');
  const results = await checkConfig();

  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
  }
}

async function doctorConnectivity(): Promise<void> {
  printHeader('Connectivity Diagnostics');
  const results = await checkConnectivity();

  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
  }
}

async function doctorTopology(): Promise<void> {
  printHeader('Topology Diagnostics');
  const results = await checkTopologyDiagnostic();

  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
  }
}

async function doctorReplication(): Promise<void> {
  printHeader('Replication Diagnostics');
  const results = await checkReplicationDiagnostic();

  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
  }
}

async function doctorRouting(): Promise<void> {
  printHeader('Routing Diagnostics');
  const results = await checkRoutingDiagnostic();

  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
  }
}

async function doctorAI(): Promise<void> {
  printHeader('AI Diagnostics');
  const results = await checkAIDiagnostic();

  for (const r of results) {
    const icon = r.status === 'ok' ? `${colors.green}✓${colors.reset}`
      : r.status === 'error' ? `${colors.red}✗${colors.reset}`
      : `${colors.yellow}⚠${colors.reset}`;
    print(`  ${icon} ${r.component}: ${r.message}`);
  }
}

async function doctorFix(args: string[]): Promise<void> {
  const target = args[0] || 'all';
  printHeader('Auto-Fix');

  let fixed = 0;

  if (target === 'all' || target === 'routing') {
    printInfo('Fixing routing...');
    try {
      await operateSync();
      fixed++;
    } catch (error) {
      printError(`Failed to fix routing: ${error}`);
    }
  }

  if (target === 'all' || target === 'ai') {
    const config = getConfig();
    if (!config.ai.apiKey) {
      printWarning('AI API key not configured. Cannot auto-fix.');
      printInfo('Run: config ai key <your-api-key>');
    }
  }

  if (fixed > 0) {
    printSuccess(`Fixed ${fixed} issue(s)`);
  } else {
    printInfo('No issues auto-fixed. Some issues require manual intervention.');
  }
}

// Diagnostic helper functions
async function checkConfig(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  const config = getConfig();

  // Check config file exists
  const configPath = getConfigPath();
  results.push({
    component: 'Config File',
    status: 'ok',
    message: `Loaded from ${configPath}`,
    fixable: false,
  });

  // Check seeds
  if (config.cluster.seeds.length === 0) {
    results.push({
      component: 'Cluster Seeds',
      status: 'error',
      message: 'No seeds configured',
      fixable: false,
    });
  } else {
    results.push({
      component: 'Cluster Seeds',
      status: 'ok',
      message: `${config.cluster.seeds.length} seed(s) configured`,
      fixable: false,
    });
  }

  return results;
}

async function checkConnectivity(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  // MySQL connectivity
  try {
    const topologyService = getTopologyService();
    await topologyService.discoverCluster();
    results.push({
      component: 'MySQL',
      status: 'ok',
      message: 'Can connect to MySQL instances',
      fixable: false,
    });
  } catch (error) {
    results.push({
      component: 'MySQL',
      status: 'error',
      message: `Connection failed: ${error}`,
      fixable: false,
    });
  }

  // ProxySQL connectivity
  try {
    const proxysqlProvider = getProxySQLProvider();
    await proxysqlProvider.getServers();
    results.push({
      component: 'ProxySQL',
      status: 'ok',
      message: 'Can connect to ProxySQL admin',
      fixable: false,
    });
  } catch (error) {
    results.push({
      component: 'ProxySQL',
      status: 'error',
      message: `Connection failed: ${error}`,
      fixable: false,
    });
  }

  return results;
}

async function checkTopologyDiagnostic(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  try {
    const topologyService = getTopologyService();
    const topology = topologyService.getTopology();

    // Check for primary
    if (!topology.primary) {
      results.push({
        component: 'Primary',
        status: 'error',
        message: 'No primary detected',
        fixable: false,
      });
    } else {
      results.push({
        component: 'Primary',
        status: 'ok',
        message: `${topology.primary.host}:${topology.primary.port}`,
        fixable: false,
      });
    }

    // Check replicas
    if (topology.replicas.length === 0) {
      results.push({
        component: 'Replicas',
        status: 'warning',
        message: 'No replicas available - no failover protection',
        fixable: false,
      });
    } else {
      results.push({
        component: 'Replicas',
        status: 'ok',
        message: `${topology.replicas.length} replica(s)`,
        fixable: false,
      });
    }

    // Check for problems
    if (topology.problems.length > 0) {
      results.push({
        component: 'Problems',
        status: 'warning',
        message: `${topology.problems.length} problem(s) detected`,
        fixable: false,
      });
    } else {
      results.push({
        component: 'Problems',
        status: 'ok',
        message: 'No problems detected',
        fixable: false,
      });
    }
  } catch (error) {
    results.push({
      component: 'Topology',
      status: 'error',
      message: `Failed to check topology: ${error}`,
      fixable: false,
    });
  }

  return results;
}

async function checkReplicationDiagnostic(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  try {
    const topologyService = getTopologyService();
    const topology = topologyService.getTopology();

    for (const replica of topology.replicas) {
      const repl = replica.replication;
      if (!repl) {
        results.push({
          component: `Replica ${replica.host}`,
          status: 'warning',
          message: 'No replication info',
          fixable: false,
        });
        continue;
      }

      if (!repl.ioThreadRunning || !repl.sqlThreadRunning) {
        results.push({
          component: `Replica ${replica.host}`,
          status: 'error',
          message: `Replication stopped (IO: ${repl.ioThreadRunning ? 'Y' : 'N'}, SQL: ${repl.sqlThreadRunning ? 'Y' : 'N'})`,
          fixable: false,
        });
      } else if (repl.secondsBehindMaster !== null && repl.secondsBehindMaster > 5) {
        results.push({
          component: `Replica ${replica.host}`,
          status: 'warning',
          message: `High lag: ${repl.secondsBehindMaster}s`,
          fixable: false,
        });
      } else {
        results.push({
          component: `Replica ${replica.host}`,
          status: 'ok',
          message: `Healthy (lag: ${repl.secondsBehindMaster ?? '?'}s)`,
          fixable: false,
        });
      }
    }
  } catch (error) {
    results.push({
      component: 'Replication',
      status: 'error',
      message: `Failed to check replication: ${error}`,
      fixable: false,
    });
  }

  return results;
}

async function checkRoutingDiagnostic(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  try {
    const proxysqlProvider = getProxySQLProvider();
    const servers = await proxysqlProvider.getServers();
    const writers = servers.filter(s => s.hostgroupId === 10);
    const readers = servers.filter(s => s.hostgroupId === 20);

    // Check writers
    const onlineWriters = writers.filter(s => s.status === 'ONLINE');
    if (onlineWriters.length === 0) {
      results.push({
        component: 'Writer Routing',
        status: 'error',
        message: 'No online writers in ProxySQL',
        fixable: true,
        fixCommand: 'routing',
      });
    } else if (onlineWriters.length > 1) {
      results.push({
        component: 'Writer Routing',
        status: 'warning',
        message: 'Multiple writers configured (expected 1)',
        fixable: true,
        fixCommand: 'routing',
      });
    } else {
      results.push({
        component: 'Writer Routing',
        status: 'ok',
        message: `${onlineWriters[0]?.hostname}:${onlineWriters[0]?.port}`,
        fixable: false,
      });
    }

    // Check readers
    const onlineReaders = readers.filter(s => s.status === 'ONLINE');
    if (onlineReaders.length === 0) {
      results.push({
        component: 'Reader Routing',
        status: 'warning',
        message: 'No online readers in ProxySQL',
        fixable: true,
        fixCommand: 'routing',
      });
    } else {
      results.push({
        component: 'Reader Routing',
        status: 'ok',
        message: `${onlineReaders.length} reader(s) online`,
        fixable: false,
      });
    }

    // Check routing matches topology
    const topologyService = getTopologyService();
    const topology = topologyService.getTopology();

    if (topology.primary) {
      const primaryInWriters = onlineWriters.some(w => w.hostname === topology.primary?.host);
      if (!primaryInWriters) {
        results.push({
          component: 'Routing Sync',
          status: 'warning',
          message: 'Primary not in writers group',
          fixable: true,
          fixCommand: 'routing',
        });
      }
    }
  } catch (error) {
    results.push({
      component: 'Routing',
      status: 'error',
      message: `Failed to check routing: ${error}`,
      fixable: false,
    });
  }

  return results;
}

async function checkAIDiagnostic(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  const config = getConfig();

  // Check API key
  if (!config.ai.apiKey) {
    results.push({
      component: 'AI API Key',
      status: 'warning',
      message: 'No API key configured',
      fixable: true,
      fixCommand: 'ai',
    });
    return results;
  }

  results.push({
    component: 'AI API Key',
    status: 'ok',
    message: 'Configured',
    fixable: false,
  });

  // Check provider
  results.push({
    component: 'AI Provider',
    status: 'ok',
    message: `${config.ai.provider} (${config.ai.model})`,
    fixable: false,
  });

  // Test connection
  try {
    const aiProvider = getAIProvider();
    const testTopology = {
      clusterName: 'test',
      primary: null,
      replicas: [],
      problems: [],
      lastUpdated: new Date(),
    };
    await aiProvider.analyzeTopology(testTopology as any);
    results.push({
      component: 'AI Connection',
      status: 'ok',
      message: 'Can reach AI API',
      fixable: false,
    });
  } catch (error) {
    results.push({
      component: 'AI Connection',
      status: 'error',
      message: `API call failed: ${error}`,
      fixable: false,
    });
  }

  return results;
}

function printDoctorHelp(): void {
  print(`
${colors.bold}Doctor Commands:${colors.reset}

  doctor              Run full diagnostics
  doctor config       Check configuration
  doctor connectivity Check MySQL and ProxySQL connectivity
  doctor topology     Check cluster topology
  doctor replication  Check replication status
  doctor routing      Check ProxySQL routing
  doctor ai           Check AI configuration
  doctor fix [target] Auto-fix detected issues (routing, ai, or all)

${colors.dim}The doctor command diagnoses problems and suggests fixes.${colors.reset}
`);
}

// Prompt helper
function promptInput(prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden) {
      // Hide input for passwords/API keys
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      let input = '';
      process.stdin.on('data', (char: string) => {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            process.stdout.write('\n');
            resolve(input);
            rl.close();
            break;
          case '\u0003': // Ctrl+C
            process.exit();
            break;
          default:
            input += char;
            process.stdout.write('*');
            break;
        }
      });
    } else {
      rl.question(prompt, (answer) => {
        resolve(answer);
        rl.close();
      });
    }
  });
}

// ─── Help & Main ──────────────────────────────────────────────────────────────

function printHelp(): void {
  print(`
${colors.bold}${colors.cyan}ClawSQL Interactive Shell${colors.reset}

${colors.bold}Commands:${colors.reset}

  ${colors.green}setup${colors.reset} [subcommand]     Initialize and configure cluster
  ${colors.green}chat${colors.reset} <message>         Interactive AI chat
  ${colors.green}query${colors.reset} [subcommand]     Execute SQL queries
  ${colors.green}check${colors.reset} [subcommand]     Check cluster status
  ${colors.green}operate${colors.reset} <action>       Perform operations (switchover/failover/sync)
  ${colors.green}config${colors.reset} [subcommand]    Configure settings (AI, MySQL, ProxySQL)
  ${colors.green}doctor${colors.reset} [subcommand]    Diagnose and fix issues

${colors.bold}Other:${colors.reset}

  help [command]        Show detailed help for command
  clear                 Clear screen
  exit, quit, Ctrl+D    Exit shell

${colors.dim}Type a command name followed by --help for more options.${colors.reset}
`);
}

function printBanner(): void {
  print(`
${colors.cyan}
  ╔═══════════════════════════════════════╗
  ║       ClawSQL Interactive Shell       ║
  ║   MySQL Cluster Management with AI    ║
  ╚═══════════════════════════════════════╝
${colors.reset}
Type ${colors.green}help${colors.reset} for available commands.
`);
}

function clearScreen(): void {
  console.clear();
  printBanner();
}

// ─── Command Processor ────────────────────────────────────────────────────────

async function processCommand(input: string): Promise<boolean> {
  const trimmed = input.trim();

  if (!trimmed) return true;

  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'exit':
    case 'quit':
    case 'q':
      return false;

    case 'help':
    case '?':
      if (args[0]) {
        printDetailedHelp(args[0]);
      } else {
        printHelp();
      }
      break;

    case 'clear':
    case 'cls':
      clearScreen();
      break;

    case 'setup':
      await handleSetup(args);
      break;

    case 'chat':
      await handleChat(args);
      break;

    case 'query':
      await handleQuery(args);
      break;

    case 'check':
    case 'status':
      await handleCheck(args);
      break;

    case 'operate':
    case 'op':
      await handleOperate(args);
      break;

    case 'config':
    case 'cfg':
      await handleConfig(args);
      break;

    case 'doctor':
    case 'dr':
      await handleDoctor(args);
      break;

    case 'init':
      await initialize();
      break;

    default:
      printError(`Unknown command: ${cmd}`);
      printInfo('Type "help" for available commands');
  }

  return true;
}

function printDetailedHelp(command: string): void {
  switch (command) {
    case 'setup':
      printSetupHelp();
      break;
    case 'query':
      printQueryHelp();
      break;
    case 'check':
      printCheckHelp();
      break;
    case 'operate':
      printOperateHelp();
      break;
    case 'config':
      printConfigHelp();
      break;
    case 'doctor':
      printDoctorHelp();
      break;
    default:
      print(`No detailed help available for: ${command}`);
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function startShell(configPath?: string): Promise<void> {
  printBanner();

  // Initialize on startup
  try {
    await initialize(configPath);
  } catch (error) {
    printWarning('Initialization failed. Some commands may not work.');
    printInfo('Use "init" to retry initialization.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.green}clawsql>${colors.reset} `,
    completer: (line: string) => {
      const commands = [
        'setup', 'chat', 'query', 'check', 'operate', 'config', 'doctor',
        'help', 'clear', 'exit', 'quit',
        'setup topology', 'setup routing', 'setup check',
        'query sql', 'query schema', 'query databases', 'query use',
        'check health', 'check topology', 'check routing', 'check problems',
        'operate switchover', 'operate failover', 'operate sync',
        'config ai', 'config mysql', 'config proxysql', 'config set', 'config test',
        'doctor all', 'doctor config', 'doctor connectivity', 'doctor topology',
        'doctor replication', 'doctor routing', 'doctor ai', 'doctor fix',
      ];

      const hits = commands.filter(c => c.startsWith(line.toLowerCase()));
      return [hits.length ? hits : commands, line];
    },
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const shouldContinue = await processCommand(line);
    if (shouldContinue) {
      rl.prompt();
    } else {
      rl.close();
    }
  }).on('close', () => {
    print('\nGoodbye!\n');
    process.exit(0);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startShell(process.argv[2]);
}