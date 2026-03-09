#!/usr/bin/env node
/**
 * CLI Entry Point
 *
 * Command-line interface for ClawSQL using Commander.
 */
import { Command } from 'commander';
import { loadConfig, getConfig } from '../config/index.js';
import { initLogger, getRootLogger } from '../logger.js';
import { getMySQLProvider } from '../providers/mysql.js';
import { getProxySQLProvider } from '../providers/proxysql.js';
import { getAIProvider } from '../providers/ai.js';
import { getTopologyService } from '../services/topology.js';
import { getFailoverService } from '../services/failover.js';
import { getHealthService } from '../services/health.js';
import { startServer } from '../api/server.js';
const log = getRootLogger();
const program = new Command();
program
    .name('clawsql')
    .description('ClawSQL - MySQL cluster management with AI-powered failover')
    .version('1.0.0')
    .option('-c, --config <path>', 'Path to config file')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .option('--json', 'Output as JSON', false);
// Initialize on command execution
program.hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    const config = loadConfig(options.config);
    // Override log level if verbose
    if (options.verbose) {
        config.logging.level = 'debug';
    }
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
});
// ─── Topology Commands ──────────────────────────────────────────────────────
const topologyCmd = program.command('topology').description('Manage cluster topology');
topologyCmd
    .command('show')
    .description('Show current topology')
    .action(async () => {
    const options = program.opts();
    const topologyService = getTopologyService();
    try {
        await topologyService.discoverCluster();
        const topology = topologyService.getTopology();
        if (options.json) {
            console.log(JSON.stringify(topology, null, 2));
        }
        else {
            console.log('\n=== Cluster Topology ===');
            console.log(`Cluster: ${topology.clusterName}`);
            console.log(`\nPrimary:`);
            if (topology.primary) {
                console.log(`  ${topology.primary.host}:${topology.primary.port} (server_id=${topology.primary.serverId})`);
            }
            else {
                console.log('  (none detected)');
            }
            console.log(`\nReplicas (${topology.replicas.length}):`);
            for (const r of topology.replicas) {
                const repl = r.replication;
                const lag = repl?.secondsBehindMaster !== null && repl?.secondsBehindMaster !== undefined
                    ? `${repl.secondsBehindMaster}s` : '?';
                console.log(`  ${r.host}:${r.port} (lag=${lag})`);
            }
            if (topology.problems.length > 0) {
                console.log(`\nProblems (${topology.problems.length}):`);
                for (const p of topology.problems) {
                    console.log(`  [${p.severity}] ${p.type}: ${p.message}`);
                }
            }
        }
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
topologyCmd
    .command('discover')
    .description('Discover cluster topology from seeds')
    .option('--seeds <hosts>', 'Comma-separated seed hosts')
    .action(async () => {
    const topologyService = getTopologyService();
    try {
        const topology = await topologyService.discoverCluster();
        console.log(`Discovered ${topology.replicas.length + (topology.primary ? 1 : 0)} instances`);
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
topologyCmd
    .command('watch')
    .description('Watch topology for changes')
    .option('-i, --interval <ms>', 'Polling interval in ms', '5000')
    .action(async (cmdOptions) => {
    const topologyService = getTopologyService();
    const interval = parseInt(cmdOptions.interval, 10);
    topologyService.on('topology_change', (event) => {
        console.log(`\n[${event.timestamp.toISOString()}] ${event.message}`);
    });
    topologyService.startPolling(interval);
    console.log('Watching topology for changes (Ctrl+C to stop)...');
    // Keep running
    process.on('SIGINT', () => {
        console.log('\nStopping...');
        topologyService.stopPolling();
        process.exit(0);
    });
});
// ─── Failover Commands ──────────────────────────────────────────────────────
program
    .command('switchover')
    .description('Perform graceful switchover')
    .option('-t, --target <host>', 'Target host to promote')
    .option('--dry-run', 'Check if switchover is possible without executing')
    .action(async (cmdOptions) => {
    const failoverService = getFailoverService();
    const topologyService = getTopologyService();
    try {
        // Discover topology first
        await topologyService.discoverCluster();
        if (cmdOptions.dryRun) {
            const check = await failoverService.canSwitchover();
            console.log('\nSwitchover Check:');
            console.log(`  Can switchover: ${check.canSwitchover}`);
            if (check.reasons.length > 0) {
                console.log(`  Reasons: ${check.reasons.join(', ')}`);
            }
            if (check.warnings.length > 0) {
                console.log(`  Warnings: ${check.warnings.join(', ')}`);
            }
            console.log(`  Suggested target: ${check.suggestedTarget ?? 'none'}`);
        }
        else {
            console.log('Starting switchover...');
            const result = await failoverService.switchover(cmdOptions.target);
            if (result.success) {
                console.log(`\nSwitchover completed!`);
                console.log(`  Old primary: ${result.oldPrimary}`);
                console.log(`  New primary: ${result.newPrimary}`);
                console.log(`  Duration: ${result.duration}ms`);
            }
            else {
                console.error(`\nSwitchover failed: ${result.message}`);
                process.exit(1);
            }
        }
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
program
    .command('failover')
    .description('Perform emergency failover')
    .option('--force', 'Force failover without confirmation')
    .action(async (cmdOptions) => {
    const failoverService = getFailoverService();
    try {
        if (!cmdOptions.force) {
            console.log('WARNING: Emergency failover may result in data loss.');
            console.log('Use --force to proceed.');
            process.exit(1);
        }
        console.log('Starting emergency failover...');
        const result = await failoverService.failover();
        if (result.success) {
            console.log(`\nFailover completed!`);
            console.log(`  New primary: ${result.newPrimary}`);
            console.log(`  Duration: ${result.duration}ms`);
        }
        else {
            console.error(`\nFailover failed: ${result.message}`);
            process.exit(1);
        }
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
program
    .command('rollback')
    .description('Rollback to previous topology')
    .action(async () => {
    const failoverService = getFailoverService();
    try {
        const result = await failoverService.rollback();
        console.log(result.message);
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
// ─── Routing Commands ────────────────────────────────────────────────────────
const routingCmd = program.command('routing').description('Manage ProxySQL routing');
routingCmd
    .command('show')
    .description('Show current routing')
    .action(async () => {
    const options = program.opts();
    const proxysqlProvider = getProxySQLProvider();
    try {
        const servers = await proxysqlProvider.getServers();
        if (options.json) {
            console.log(JSON.stringify(servers, null, 2));
        }
        else {
            console.log('\n=== ProxySQL Routing ===\n');
            const writers = servers.filter(s => s.hostgroupId === 10);
            const readers = servers.filter(s => s.hostgroupId === 20);
            console.log('Writers (HG 10):');
            for (const s of writers) {
                console.log(`  ${s.hostname}:${s.port} status=${s.status} weight=${s.weight}`);
            }
            if (writers.length === 0)
                console.log('  (none)');
            console.log('\nReaders (HG 20):');
            for (const s of readers) {
                console.log(`  ${s.hostname}:${s.port} status=${s.status} weight=${s.weight}`);
            }
            if (readers.length === 0)
                console.log('  (none)');
        }
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
routingCmd
    .command('sync')
    .description('Sync routing with topology')
    .action(async () => {
    const topologyService = getTopologyService();
    const proxysqlProvider = getProxySQLProvider();
    try {
        const topology = topologyService.getTopology();
        const primary = topology.primary?.host;
        const replicas = topology.replicas.map(r => r.host);
        if (!primary) {
            console.error('No primary detected');
            process.exit(1);
        }
        const result = await proxysqlProvider.syncTopology(primary, replicas);
        console.log(`Synced: ${result.added.length} added, ${result.removed.length} removed`);
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
// ─── Health Commands ─────────────────────────────────────────────────────────
const healthCmd = program.command('health').description('Check cluster health');
healthCmd
    .command('check')
    .description('Run health check')
    .action(async () => {
    const options = program.opts();
    const healthService = getHealthService();
    try {
        const health = await healthService.getHealth();
        if (options.json) {
            console.log(JSON.stringify(health, null, 2));
        }
        else {
            console.log('\n=== Health Check ===\n');
            console.log(`Overall: ${health.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
            console.log(`\nMySQL: ${health.components.mysql.healthy ? '✓' : '✗'} ${health.components.mysql.message}`);
            console.log(`ProxySQL: ${health.components.proxysql.healthy ? '✓' : '✗'} ${health.components.proxysql.message}`);
            console.log(`Topology: ${health.components.topology.healthy ? '✓' : '✗'} ${health.components.topology.message}`);
        }
        process.exit(health.healthy ? 0 : 1);
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
healthCmd
    .command('watch')
    .description('Watch health status')
    .option('-i, --interval <seconds>', 'Check interval in seconds', '5')
    .action(async (cmdOptions) => {
    const healthService = getHealthService();
    const interval = parseInt(cmdOptions.interval, 10) * 1000;
    console.log('Watching health status (Ctrl+C to stop)...\n');
    const check = async () => {
        const health = await healthService.getHealth();
        const status = health.healthy ? '✓' : '✗';
        console.log(`[${new Date().toISOString()}] ${status} MySQL: ${health.components.mysql.message}`);
    };
    await check();
    setInterval(check, interval);
});
// ─── AI Commands ─────────────────────────────────────────────────────────────
const aiCmd = program.command('ai').description('AI-powered analysis');
aiCmd
    .command('analyze')
    .description('Analyze topology with AI')
    .action(async () => {
    const options = program.opts();
    const aiProvider = getAIProvider();
    const topologyService = getTopologyService();
    try {
        const topology = topologyService.getTopology();
        const analysis = await aiProvider.analyzeTopology(topology);
        if (options.json) {
            console.log(JSON.stringify(analysis, null, 2));
        }
        else {
            console.log('\n=== AI Analysis ===\n');
            console.log(`Health: ${analysis.healthy ? 'Healthy' : 'Unhealthy'}`);
            console.log(`Risk Level: ${analysis.riskLevel}`);
            console.log(`\nRecommendations:`);
            for (const r of analysis.recommendations) {
                console.log(`  - ${r}`);
            }
        }
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
aiCmd
    .command('recommend')
    .description('Get failover recommendations')
    .action(async () => {
    const aiProvider = getAIProvider();
    const topologyService = getTopologyService();
    try {
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
        console.log('\n=== Failover Recommendation ===\n');
        console.log(`Recommended: ${recommendation.recommendedHost}`);
        console.log(`Confidence: ${(recommendation.confidence * 100).toFixed(0)}%`);
        console.log(`Reasoning: ${recommendation.reasoning}`);
        if (recommendation.alternatives.length > 0) {
            console.log('\nAlternatives:');
            for (const alt of recommendation.alternatives) {
                console.log(`  - ${alt.host}: ${alt.reason}`);
            }
        }
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
aiCmd
    .command('query')
    .description('Natural language query')
    .argument('<query>', 'Natural language query')
    .action(async (query) => {
    const aiProvider = getAIProvider();
    try {
        const parsed = await aiProvider.parseCommand(query);
        console.log('\nParsed intent:', parsed.intent);
        if (parsed.target) {
            console.log('Target:', parsed.target);
        }
        console.log('Confidence:', parsed.confidence);
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
// ─── Serve Command ───────────────────────────────────────────────────────────
program
    .command('serve')
    .description('Start the REST API server')
    .option('-p, --port <port>', 'Server port')
    .option('-h, --host <host>', 'Server host')
    .action(async (cmdOptions) => {
    const config = getConfig();
    if (cmdOptions.port) {
        config.api.port = parseInt(cmdOptions.port, 10);
    }
    if (cmdOptions.host) {
        config.api.host = cmdOptions.host;
    }
    try {
        // Initialize topology service and start polling
        const topologyService = getTopologyService();
        topologyService.startPolling(config.scheduler.topologyPollInterval);
        const fastify = await startServer(config);
        console.log(`\nClawSQL API server running at http://${config.api.host}:${config.api.port}`);
        console.log('Press Ctrl+C to stop\n');
        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\nShutting down...');
            topologyService.stopPolling();
            await fastify.close();
            process.exit(0);
        });
    }
    catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
});
// ─── Config Command ──────────────────────────────────────────────────────────
program
    .command('config')
    .description('Configuration management')
    .command('show')
    .description('Show current configuration')
    .action(async () => {
    const options = program.opts();
    const config = getConfig();
    if (options.json) {
        console.log(JSON.stringify(config, null, 2));
    }
    else {
        console.log('\n=== Configuration ===\n');
        console.log(`Cluster: ${config.cluster.name}`);
        console.log(`Seeds: ${config.cluster.seeds.join(', ')}`);
        console.log(`\nMySQL:`);
        console.log(`  User: ${config.mysql.user}`);
        console.log(`  Pool: ${config.mysql.connectionPool}`);
        console.log(`\nProxySQL:`);
        console.log(`  Host: ${config.proxysql.host}:${config.proxysql.adminPort}`);
        console.log(`  Writer HG: ${config.proxysql.hostgroups.writer}`);
        console.log(`  Reader HG: ${config.proxysql.hostgroups.reader}`);
        console.log(`\nAPI:`);
        console.log(`  Port: ${config.api.port}`);
        console.log(`  Host: ${config.api.host}`);
    }
});
// Parse and run
program.parse();
//# sourceMappingURL=index.js.map