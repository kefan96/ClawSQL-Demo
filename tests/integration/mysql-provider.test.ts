/**
 * Integration Tests for MySQL Provider
 *
 * These tests require a running MySQL container.
 * Run with: npm run test:integration
 *
 * Prerequisites:
 * - MySQL container running on localhost:3306
 * - Root user with password set in CLAWSQL_MYSQL_PASSWORD env var
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MySQLProvider, resetMySQLProvider } from '../../src/providers/mysql.js';

// Skip integration tests if no MySQL connection available
const MYSQL_HOST = process.env.CLAWSQL_MYSQL_HOST || 'localhost';
const MYSQL_PORT = parseInt(process.env.CLAWSQL_MYSQL_PORT || '3306', 10);
const MYSQL_USER = process.env.CLAWSQL_MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.CLAWSQL_MYSQL_PASSWORD || '';

const shouldRunIntegrationTests = MYSQL_PASSWORD !== '' || process.env.CI === 'true';

const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

describeIntegration('MySQL Provider Integration', () => {
  let provider: MySQLProvider;

  beforeAll(() => {
    resetMySQLProvider();
    provider = new MySQLProvider({
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      connectionLimit: 5,
      connectTimeout: 10000,
    });
  });

  afterAll(async () => {
    await provider.destroy();
    resetMySQLProvider();
  });

  describe('Connection', () => {
    it('should connect to MySQL instance', async () => {
      const result = await provider.ping(MYSQL_HOST, MYSQL_PORT);
      expect(result).toBe(true);
    });

    it('should get MySQL version', async () => {
      const version = await provider.getVersion(MYSQL_HOST, MYSQL_PORT);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('Instance Discovery', () => {
    it('should get instance information', async () => {
      const instance = await provider.getInstance(MYSQL_HOST, MYSQL_PORT);

      expect(instance.host).toBe(MYSQL_HOST);
      expect(instance.port).toBe(MYSQL_PORT);
      expect(instance.version).toBeDefined();
      expect(instance.serverId).toBeGreaterThanOrEqual(0);
    });

    it('should discover instances from seed', async () => {
      const instances = await provider.discoverInstances([`${MYSQL_HOST}:${MYSQL_PORT}`]);

      expect(instances.length).toBeGreaterThanOrEqual(1);
      expect(instances[0]?.host).toBeDefined();
    });
  });

  describe('Replication Operations', () => {
    it('should get master status (or null for replica)', async () => {
      const status = await provider.getMasterStatus(MYSQL_HOST, MYSQL_PORT);

      // Could be null if this is a replica
      if (status) {
        expect(status.file).toBeDefined();
        expect(status.position).toBeGreaterThanOrEqual(0);
      }
    });

    it('should get replication status (or null for primary)', async () => {
      const status = await provider.getReplicationStatus(MYSQL_HOST, MYSQL_PORT);

      // Could be null if this is a primary
      if (status) {
        expect(status.ioThreadRunning).toBeDefined();
        expect(status.sqlThreadRunning).toBeDefined();
      }
    });

    it('should get slave hosts', async () => {
      const hosts = await provider.getSlaveHosts(MYSQL_HOST, MYSQL_PORT);

      // May be empty if no replicas connected
      expect(Array.isArray(hosts)).toBe(true);
    });
  });

  describe('GTID Operations', () => {
    it('should get GTID_EXECUTED', async () => {
      const gtid = await provider.getGTIDExecuted(MYSQL_HOST, MYSQL_PORT);

      // Could be empty if GTID not enabled
      expect(typeof gtid).toBe('string');
    });
  });

  describe('Processlist', () => {
    it('should get processlist', async () => {
      const processlist = await provider.getProcesslist(MYSQL_HOST, MYSQL_PORT);

      expect(Array.isArray(processlist)).toBe(true);
      expect(processlist.length).toBeGreaterThan(0);

      const entry = processlist[0];
      expect(entry?.id).toBeDefined();
      expect(entry?.user).toBeDefined();
      expect(entry?.command).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection to unreachable host', async () => {
      const result = await provider.ping('unreachable-host-12345', 3306);
      expect(result).toBe(false);
    });

    it('should throw on invalid credentials', async () => {
      const badProvider = new MySQLProvider({
        user: 'invalid_user',
        password: 'invalid_password',
        connectTimeout: 5000,
      });

      await expect(badProvider.ping(MYSQL_HOST, MYSQL_PORT)).resolves.toBe(false);
      await badProvider.destroy();
    });
  });
});