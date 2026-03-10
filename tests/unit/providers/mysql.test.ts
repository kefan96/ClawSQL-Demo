/**
 * Unit tests for MySQL Provider
 *
 * Tests use mocked mysql2/promise to avoid actual database connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MySQLProvider, getMySQLProvider, resetMySQLProvider } from '../../src/providers/mysql.js';

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

describe('MySQLProvider', () => {
  let provider: MySQLProvider;

  beforeEach(() => {
    resetMySQLProvider();
    vi.clearAllMocks();

    provider = new MySQLProvider({
      user: 'root',
      password: 'testpass',
      connectionLimit: 10,
      connectTimeout: 5000,
    });
  });

  afterEach(async () => {
    await provider.destroy();
    resetMySQLProvider();
    vi.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return correct Instance object for a primary', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ version: '8.0.35' }], []])
        .mockResolvedValueOnce([[{ serverId: 1 }], []])
        .mockResolvedValueOnce([[{ readOnly: 0 }], []]);

      const instance = await provider.getInstance('mysql-primary', 3306);

      expect(instance.host).toBe('mysql-primary');
      expect(instance.port).toBe(3306);
      expect(instance.version).toBe('8.0.35');
      expect(instance.serverId).toBe(1);
      expect(instance.readOnly).toBe(false);
      expect(instance.isPrimary).toBe(true);
      expect(instance.isReplica).toBe(false);
    });

    it('should return correct Instance object for a replica', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ version: '8.0.35' }], []])
        .mockResolvedValueOnce([[{ serverId: 2 }], []])
        .mockResolvedValueOnce([[{ readOnly: 1 }], []]);

      const instance = await provider.getInstance('mysql-replica', 3306);

      expect(instance.readOnly).toBe(true);
      expect(instance.isPrimary).toBe(false);
      expect(instance.isReplica).toBe(true);
    });
  });

  describe('discoverInstances', () => {
    it('should traverse primary/replica chain', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ version: '8.0.35' }], []])
        .mockResolvedValueOnce([[{ serverId: 1 }], []])
        .mockResolvedValueOnce([[{ readOnly: 0 }], []])
        .mockResolvedValueOnce([[
          { Server_id: 2, Host: 'replica-1', Port: 3306, Master_id: 1 },
        ], []])
        .mockResolvedValueOnce([[{ version: '8.0.35' }], []])
        .mockResolvedValueOnce([[{ serverId: 2 }], []])
        .mockResolvedValueOnce([[{ readOnly: 1 }], []])
        .mockResolvedValueOnce([[{
          Slave_IO_Running: 'Yes',
          Slave_SQL_Running: 'Yes',
          Seconds_Behind_Master: 0,
          Master_Host: 'mysql-primary',
          Master_Port: 3306,
        }], []]);

      const instances = await provider.discoverInstances(['mysql-primary:3306']);

      expect(instances.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getReplicationStatus', () => {
    it('should parse SHOW SLAVE STATUS correctly', async () => {
      mockQuery.mockResolvedValueOnce([[
        {
          Slave_IO_Running: 'Yes',
          Slave_SQL_Running: 'Yes',
          Seconds_Behind_Master: 5,
          Master_Host: 'mysql-primary',
          Master_Port: 3306,
          Retrieved_Gtid_Set: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5',
          Relay_Master_Log_File: 'mysql-bin.000003',
          Exec_Master_Log_Pos: 727,
          Read_Master_Log_Pos: 727,
        },
      ], []]);

      const status = await provider.getReplicationStatus('mysql-replica', 3306);

      expect(status).not.toBeNull();
      expect(status?.ioThreadRunning).toBe(true);
      expect(status?.sqlThreadRunning).toBe(true);
      expect(status?.secondsBehindMaster).toBe(5);
      expect(status?.masterHost).toBe('mysql-primary');
    });

    it('should return null for primary (no slave status)', async () => {
      mockQuery.mockResolvedValueOnce([[], []]);

      const status = await provider.getReplicationStatus('mysql-primary', 3306);

      expect(status).toBeNull();
    });
  });

  describe('getSlaveHosts', () => {
    it('should parse SHOW SLAVE HOSTS correctly', async () => {
      mockQuery.mockResolvedValueOnce([[
        { Server_id: 2, Host: 'replica-1', Port: 3306, Master_id: 1 },
        { Server_id: 3, Host: 'replica-2', Port: 3306, Master_id: 1 },
      ], []]);

      const hosts = await provider.getSlaveHosts('mysql-primary', 3306);

      expect(hosts.length).toBe(2);
      expect(hosts[0]?.host).toBe('replica-1');
      expect(hosts[1]?.host).toBe('replica-2');
    });

    it('should return empty array on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection failed'));

      const hosts = await provider.getSlaveHosts('unreachable', 3306);

      expect(hosts).toEqual([]);
    });
  });

  describe('promoteToPrimary', () => {
    it('should execute correct commands', async () => {
      mockExecute.mockResolvedValueOnce([{}, []]);
      mockExecute.mockResolvedValueOnce([{}, []]);

      await provider.promoteToPrimary('mysql-replica', 3306);

      expect(mockExecute).toHaveBeenCalledWith('STOP SLAVE');
      expect(mockExecute).toHaveBeenCalledWith('SET GLOBAL read_only = OFF');
    });
  });

  describe('setReadOnly', () => {
    it('should execute SET GLOBAL read_only ON', async () => {
      mockExecute.mockResolvedValueOnce([{}, []]);

      await provider.setReadOnly('mysql-replica', 3306, true);

      expect(mockExecute).toHaveBeenCalledWith('SET GLOBAL read_only = ON');
    });

    it('should execute SET GLOBAL read_only OFF', async () => {
      mockExecute.mockResolvedValueOnce([{}, []]);

      await provider.setReadOnly('mysql-primary', 3306, false);

      expect(mockExecute).toHaveBeenCalledWith('SET GLOBAL read_only = OFF');
    });
  });

  describe('ping', () => {
    it('should return true on successful ping', async () => {
      mockQuery.mockResolvedValueOnce([[{ 1: 1 }], []]);

      const result = await provider.ping('mysql-primary', 3306);

      expect(result).toBe(true);
    });

    it('should return false on failed ping', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await provider.ping('unreachable', 3306);

      expect(result).toBe(false);
    });
  });

  describe('getGTIDExecuted', () => {
    it('should return GTID string', async () => {
      mockQuery.mockResolvedValueOnce([[
        { gtid: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5' },
      ], []]);

      const gtid = await provider.getGTIDExecuted('mysql-primary', 3306);

      expect(gtid).toBe('3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5');
    });
  });

  describe('Pool management', () => {
    it('should create and reuse pools', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ version: '8.0.35' }], []])
        .mockResolvedValueOnce([[{ serverId: 1 }], []])
        .mockResolvedValueOnce([[{ readOnly: 0 }], []]);
      await provider.getInstance('host1', 3306);

      mockQuery
        .mockResolvedValueOnce([[{ version: '8.0.35' }], []])
        .mockResolvedValueOnce([[{ serverId: 1 }], []])
        .mockResolvedValueOnce([[{ readOnly: 0 }], []]);
      await provider.getInstance('host1', 3306);

      const mysql = await import('mysql2/promise');
      expect(mysql.default.createPool).toHaveBeenCalledTimes(1);
    });

    it('should create separate pools for different hosts', async () => {
      mockQuery
        .mockResolvedValue([[{ version: '8.0.35' }], []])
        .mockResolvedValue([[{ serverId: 1 }], []])
        .mockResolvedValue([[{ readOnly: 0 }], []]);

      await provider.getInstance('host1', 3306);
      await provider.getInstance('host2', 3306);

      const mysql = await import('mysql2/promise');
      expect(mysql.default.createPool).toHaveBeenCalledTimes(2);
    });

    it('should close all pools on destroy', async () => {
      mockQuery
        .mockResolvedValue([[{ version: '8.0.35' }], []])
        .mockResolvedValue([[{ serverId: 1 }], []])
        .mockResolvedValue([[{ readOnly: 0 }], []]);

      await provider.getInstance('host1', 3306);
      await provider.getInstance('host2', 3306);
      await provider.destroy();

      expect(mockEnd).toHaveBeenCalled();
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetMySQLProvider();
  });

  afterEach(() => {
    resetMySQLProvider();
  });

  it('should create singleton instance', () => {
    const provider = getMySQLProvider({
      user: 'root',
      password: 'test',
    });

    expect(provider).toBeInstanceOf(MySQLProvider);

    const same = getMySQLProvider();
    expect(same).toBe(provider);
  });

  it('should throw if not initialized', () => {
    expect(() => getMySQLProvider()).toThrow('MySQL provider not initialized');
  });

  it('should reset singleton', () => {
    getMySQLProvider({ user: 'root', password: 'test' });
    resetMySQLProvider();

    expect(() => getMySQLProvider()).toThrow('MySQL provider not initialized');
  });
});