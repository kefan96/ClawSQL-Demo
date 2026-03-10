/**
 * Unit tests for ProxySQL Provider
 *
 * Tests use mocked mysql2/promise to avoid actual database connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProxySQLProvider,
  getProxySQLProvider,
  resetProxySQLProvider,
  Hostgroups,
} from '../../src/providers/proxysql.js';

// Create a single mock pool instance that will be reused
const mockQuery = vi.fn();
const mockExecute = vi.fn();
const mockEnd = vi.fn();
const mockPool = {
  query: mockQuery,
  execute: mockExecute,
  end: mockEnd,
};

// Mock mysql2/promise module - always return the same pool
vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => mockPool),
  },
}));

describe('ProxySQLProvider', () => {
  let provider: ProxySQLProvider;

  const defaultConfig = {
    host: 'proxysql',
    adminPort: 6032,
    dataPort: 6033,
    user: 'admin',
    password: 'admin',
    hostgroups: {
      writer: 10,
      reader: 20,
    },
  };

  beforeEach(() => {
    resetProxySQLProvider();
    vi.clearAllMocks();

    provider = new ProxySQLProvider(defaultConfig);
  });

  afterEach(async () => {
    await provider.destroy();
    resetProxySQLProvider();
    vi.clearAllMocks();
  });

  describe('getServers', () => {
    it('should return parsed server list', async () => {
      mockQuery.mockResolvedValueOnce([[
        {
          hostgroup_id: 10,
          hostname: 'mysql-primary',
          port: 3306,
          status: 'ONLINE',
          weight: 1000,
          max_connections: 200,
          use_ssl: 0,
          max_latency_ms: 0,
          comment: 'Primary',
        },
        {
          hostgroup_id: 20,
          hostname: 'mysql-replica-1',
          port: 3306,
          status: 'ONLINE',
          weight: 1000,
          max_connections: 200,
          use_ssl: 0,
          max_latency_ms: 0,
          comment: '',
        },
      ], []]);

      const servers = await provider.getServers();

      expect(servers.length).toBe(2);
      expect(servers[0]?.hostgroupId).toBe(10);
      expect(servers[0]?.hostname).toBe('mysql-primary');
      expect(servers[0]?.useSsl).toBe(false);
    });
  });

  describe('getWriters/getReaders', () => {
    it('should filter servers by hostgroup', async () => {
      mockQuery.mockResolvedValue([[
        {
          hostgroup_id: 10,
          hostname: 'mysql-primary',
          port: 3306,
          status: 'ONLINE',
          weight: 1000,
          max_connections: 200,
          use_ssl: 0,
          max_latency_ms: 0,
          comment: '',
        },
        {
          hostgroup_id: 20,
          hostname: 'mysql-replica-1',
          port: 3306,
          status: 'ONLINE',
          weight: 1000,
          max_connections: 200,
          use_ssl: 0,
          max_latency_ms: 0,
          comment: '',
        },
      ], []]);

      const writers = await provider.getWriters();
      expect(writers.length).toBe(1);
      expect(writers[0]?.hostgroupId).toBe(10);

      const readers = await provider.getReaders();
      expect(readers.length).toBe(1);
      expect(readers[0]?.hostgroupId).toBe(20);
    });
  });

  describe('addServer', () => {
    it('should execute INSERT and load servers', async () => {
      mockExecute.mockResolvedValueOnce([{}, []]);
      mockExecute.mockResolvedValueOnce([{}, []]);
      mockExecute.mockResolvedValueOnce([{}, []]);

      await provider.addServer(10, 'new-server', 3306);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO mysql_servers')
      );
    });
  });

  describe('removeServer', () => {
    it('should execute DELETE for specific hostgroup', async () => {
      mockExecute.mockResolvedValue([{}, []]);

      await provider.removeServer('old-server', 3306, 10);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM mysql_servers WHERE hostname='old-server'")
      );
    });

    it('should execute DELETE for all hostgroups if not specified', async () => {
      mockExecute.mockResolvedValue([{}, []]);

      await provider.removeServer('old-server', 3306);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM mysql_servers WHERE hostname='old-server'")
      );
    });
  });

  describe('setServerStatus', () => {
    it('should update server status', async () => {
      mockExecute.mockResolvedValue([{}, []]);

      await provider.setServerStatus('mysql-primary', 3306, 10, 'OFFLINE');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("SET status='OFFLINE'")
      );
    });
  });

  describe('switchWriter', () => {
    it('should execute 4-step atomic operation', async () => {
      mockExecute.mockResolvedValue([{}, []]);

      await provider.switchWriter('old-primary', 3306, 'new-primary', 3306);

      expect(mockExecute).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("DELETE FROM mysql_servers WHERE hostname='old-primary'")
      );
      expect(mockExecute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT OR REPLACE INTO mysql_servers')
      );
      expect(mockExecute).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("DELETE FROM mysql_servers WHERE hostname='new-primary'")
      );
      expect(mockExecute).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('INSERT OR REPLACE INTO mysql_servers')
      );
    });
  });

  describe('syncTopology', () => {
    it('should update topology to match expected state', async () => {
      mockQuery.mockResolvedValueOnce([[
        {
          hostgroup_id: 10,
          hostname: 'old-primary',
          port: 3306,
          status: 'ONLINE',
          weight: 1000,
          max_connections: 200,
          use_ssl: 0,
          max_latency_ms: 0,
          comment: '',
        },
      ], []]);

      mockExecute.mockResolvedValue([{}, []]);

      const result = await provider.syncTopology('new-primary', ['replica-1', 'replica-2']);

      expect(result.success).toBe(true);
      expect(result.added.length).toBeGreaterThan(0);
    });
  });

  describe('getPoolStats', () => {
    it('should return parsed connection pool stats', async () => {
      mockQuery.mockResolvedValueOnce([[
        {
          hostgroup: 10,
          srv_host: 'mysql-primary',
          srv_port: 3306,
          status: 'ONLINE',
          ConnUsed: 5,
          ConnFree: 5,
          ConnOK: 10,
          ConnERR: 0,
          Queries: 1000,
          Bytes_data_sent: 50000,
          Bytes_data_recv: 100000,
          Latency_us: 1000,
        },
      ], []]);

      const stats = await provider.getPoolStats();

      expect(stats.length).toBe(1);
      expect(stats[0]?.hostgroupId).toBe(10);
      expect(stats[0]?.srvHost).toBe('mysql-primary');
      expect(stats[0]?.queries).toBe(1000);
    });
  });

  describe('ping', () => {
    it('should return true on successful ping', async () => {
      mockQuery.mockResolvedValueOnce([[{ 1: 1 }], []]);

      const result = await provider.ping();

      expect(result).toBe(true);
    });

    it('should return false on failed ping', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await provider.ping();

      expect(result).toBe(false);
    });
  });
});

describe('Hostgroups', () => {
  it('should have correct values', () => {
    expect(Hostgroups.WRITER).toBe(10);
    expect(Hostgroups.READER).toBe(20);
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetProxySQLProvider();
  });

  afterEach(() => {
    resetProxySQLProvider();
  });

  it('should create singleton instance', () => {
    const provider = getProxySQLProvider({
      host: 'proxysql',
      adminPort: 6032,
      dataPort: 6033,
      user: 'admin',
      password: 'admin',
      hostgroups: { writer: 10, reader: 20 },
    });

    expect(provider).toBeInstanceOf(ProxySQLProvider);

    const same = getProxySQLProvider();
    expect(same).toBe(provider);
  });

  it('should throw if not initialized', () => {
    expect(() => getProxySQLProvider()).toThrow('ProxySQL provider not initialized');
  });

  it('should reset singleton', () => {
    getProxySQLProvider({
      host: 'proxysql',
      adminPort: 6032,
      dataPort: 6033,
      user: 'admin',
      password: 'admin',
      hostgroups: { writer: 10, reader: 20 },
    });
    resetProxySQLProvider();

    expect(() => getProxySQLProvider()).toThrow('ProxySQL provider not initialized');
  });
});