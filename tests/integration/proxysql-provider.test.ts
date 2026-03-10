/**
 * Integration Tests for ProxySQL Provider
 *
 * These tests require a running ProxySQL container.
 * Run with: npm run test:integration
 *
 * Prerequisites:
 * - ProxySQL container running on localhost:6032 (admin) and 6033 (data)
 * - Admin credentials set in CLAWSQL_PROXYSQL_USER/PASSWORD env vars
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ProxySQLProvider,
  resetProxySQLProvider,
  Hostgroups,
} from '../../src/providers/proxysql.js';

// Skip integration tests if no ProxySQL connection available
const PROXYSQL_HOST = process.env.CLAWSQL_PROXYSQL_HOST || 'localhost';
const PROXYSQL_ADMIN_PORT = parseInt(process.env.CLAWSQL_PROXYSQL_ADMIN_PORT || '6032', 10);
const PROXYSQL_DATA_PORT = parseInt(process.env.CLAWSQL_PROXYSQL_DATA_PORT || '6033', 10);
const PROXYSQL_USER = process.env.CLAWSQL_PROXYSQL_USER || 'admin';
const PROXYSQL_PASSWORD = process.env.CLAWSQL_PROXYSQL_PASSWORD || 'admin';

const shouldRunIntegrationTests = process.env.CI === 'true' || process.env.RUN_INTEGRATION_TESTS === 'true';

const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

describeIntegration('ProxySQL Provider Integration', () => {
  let provider: ProxySQLProvider;

  beforeAll(() => {
    resetProxySQLProvider();
    provider = new ProxySQLProvider({
      host: PROXYSQL_HOST,
      adminPort: PROXYSQL_ADMIN_PORT,
      dataPort: PROXYSQL_DATA_PORT,
      user: PROXYSQL_USER,
      password: PROXYSQL_PASSWORD,
      hostgroups: {
        writer: 10,
        reader: 20,
      },
    });
  });

  afterAll(async () => {
    await provider.destroy();
    resetProxySQLProvider();
  });

  describe('Connection', () => {
    it('should connect to ProxySQL admin interface', async () => {
      const result = await provider.ping();
      expect(result).toBe(true);
    });
  });

  describe('Server Management', () => {
    it('should get servers list', async () => {
      const servers = await provider.getServers();

      expect(Array.isArray(servers)).toBe(true);
    });

    it('should add and remove a server', async () => {
      const testHost = 'test-server-integration';
      const testPort = 3306;

      // Add server
      await provider.addServer(Hostgroups.READER, testHost, testPort);

      // Verify added
      const serversAfterAdd = await provider.getServers();
      const added = serversAfterAdd.find(
        s => s.hostname === testHost && s.port === testPort
      );
      expect(added).toBeDefined();

      // Remove server
      await provider.removeServer(testHost, testPort, Hostgroups.READER);

      // Verify removed
      const serversAfterRemove = await provider.getServers();
      const removed = serversAfterRemove.find(
        s => s.hostname === testHost && s.port === testPort
      );
      expect(removed).toBeUndefined();
    });

    it('should update server status', async () => {
      const servers = await provider.getServers();

      if (servers.length > 0) {
        const server = servers[0]!;
        await provider.setServerStatus(
          server.hostname,
          server.port,
          server.hostgroupId,
          'OFFLINE'
        );

        const updatedServers = await provider.getServers();
        const updated = updatedServers.find(
          s => s.hostname === server.hostname && s.port === server.port
        );
        expect(updated?.status).toBe('OFFLINE');

        // Restore status
        await provider.setServerStatus(
          server.hostname,
          server.port,
          server.hostgroupId,
          'ONLINE'
        );
      }
    });
  });

  describe('Writer Switching', () => {
    it('should list writers and readers', async () => {
      const writers = await provider.getWriters();
      const readers = await provider.getReaders();

      expect(Array.isArray(writers)).toBe(true);
      expect(Array.isArray(readers)).toBe(true);
    });
  });

  describe('Pool Statistics', () => {
    it('should get pool stats', async () => {
      const stats = await provider.getPoolStats();

      expect(Array.isArray(stats)).toBe(true);
    });
  });

  describe('Query Rules', () => {
    it('should get query rules', async () => {
      const rules = await provider.getQueryRules();

      expect(Array.isArray(rules)).toBe(true);
    });
  });

  describe('Topology Sync', () => {
    it('should sync topology', async () => {
      const result = await provider.syncTopology(
        'primary-host',
        ['replica-1', 'replica-2'],
        3306
      );

      expect(result.success).toBeDefined();
      expect(Array.isArray(result.added)).toBe(true);
      expect(Array.isArray(result.removed)).toBe(true);

      // Cleanup
      await provider.removeServer('primary-host', 3306);
      await provider.removeServer('replica-1', 3306);
      await provider.removeServer('replica-2', 3306);
    });
  });

  describe('Error Handling', () => {
    it('should handle connection to unreachable host', async () => {
      const badProvider = new ProxySQLProvider({
        host: 'unreachable-proxysql-12345',
        adminPort: 6032,
        dataPort: 6033,
        user: 'admin',
        password: 'admin',
        hostgroups: { writer: 10, reader: 20 },
      });

      const result = await badProvider.ping();
      expect(result).toBe(false);

      await badProvider.destroy();
    });
  });
});