/**
 * Unit tests for Health Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthService, getHealthService, resetHealthService } from '../../src/services/health.js';
import { createMockMySQLProvider } from '../../helpers/mock-mysql.js';
import { createMockProxySQLProvider } from '../../helpers/mock-proxysql.js';
import { mockInstance, mockReplicaInstance, mockReplicationStatus } from '../../helpers/fixtures.js';

// Mock providers
vi.mock('../../src/providers/mysql.js', () => ({
  getMySQLProvider: vi.fn(),
  resetMySQLProvider: vi.fn(),
}));

vi.mock('../../src/providers/proxysql.js', () => ({
  getProxySQLProvider: vi.fn(),
  resetProxySQLProvider: vi.fn(),
}));

vi.mock('../../src/services/topology.js', () => ({
  getTopologyService: vi.fn(),
  resetTopologyService: vi.fn(),
}));

describe('HealthService', () => {
  let service: HealthService;
  let mockMySQLProvider: ReturnType<typeof createMockMySQLProvider>;
  let mockProxySQLProvider: ReturnType<typeof createMockProxySQLProvider>;
  let mockTopologyService: any;

  beforeEach(async () => {
    resetHealthService();

    mockMySQLProvider = createMockMySQLProvider();
    mockProxySQLProvider = createMockProxySQLProvider();
    mockTopologyService = {
      getTopology: vi.fn(() => ({
        clusterName: 'test-cluster',
        primary: mockInstance,
        replicas: [{ ...mockReplicaInstance, replication: mockReplicationStatus }],
        problems: [],
        lastUpdated: new Date(),
      })),
    };

    const { getMySQLProvider } = await vi.importMock('../../src/providers/mysql.js');
    const { getProxySQLProvider } = await vi.importMock('../../src/providers/proxysql.js');
    const { getTopologyService } = await vi.importMock('../../src/services/topology.js');

    getMySQLProvider.mockReturnValue(mockMySQLProvider);
    getProxySQLProvider.mockReturnValue(mockProxySQLProvider);
    getTopologyService.mockReturnValue(mockTopologyService);

    service = new HealthService();
  });

  afterEach(() => {
    resetHealthService();
    vi.clearAllMocks();
  });

  describe('getHealth', () => {
    it('should return overall health status', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockProxySQLProvider.ping.mockResolvedValue(true);
      mockProxySQLProvider.getWriters.mockResolvedValue([{ hostname: 'mysql-primary', port: 3306 }]);
      mockProxySQLProvider.getReaders.mockResolvedValue([]);

      const health = await service.getHealth();

      expect(health.healthy).toBe(true);
      expect(health.components.mysql.healthy).toBe(true);
      expect(health.components.proxysql.healthy).toBe(true);
      expect(health.components.topology.healthy).toBe(true);
    });

    it('should return unhealthy if any component fails', async () => {
      mockMySQLProvider.ping.mockResolvedValue(false);
      mockProxySQLProvider.ping.mockResolvedValue(true);
      mockProxySQLProvider.getWriters.mockResolvedValue([]);

      const health = await service.getHealth();

      expect(health.healthy).toBe(false);
    });
  });

  describe('getMySQLHealth', () => {
    it('should check all instances', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      const mysqlHealth = await service.getMySQLHealth();

      expect(mysqlHealth.healthy).toBe(true);
      expect(mysqlHealth.message).toContain('healthy');
    });

    it('should report unhealthy instances', async () => {
      mockMySQLProvider.ping
        .mockResolvedValueOnce(true) // Primary
        .mockResolvedValueOnce(false); // Replica

      const mysqlHealth = await service.getMySQLHealth();

      expect(mysqlHealth.healthy).toBe(false);
      expect(mysqlHealth.message).toContain('unhealthy');
    });
  });

  describe('checkInstanceHealth', () => {
    it('should return instance health details', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      const health = await service.checkInstanceHealth('mysql-replica-1', 3306, true);

      expect(health.host).toBe('mysql-replica-1');
      expect(health.port).toBe(3306);
      expect(health.healthy).toBe(true);
      expect(health.pingMs).toBeGreaterThanOrEqual(0);
      expect(health.replicationLag).toBe(0);
      expect(health.ioRunning).toBe(true);
      expect(health.sqlRunning).toBe(true);
    });

    it('should skip replication check for primary', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);

      const health = await service.checkInstanceHealth('mysql-primary', 3306, false);

      expect(health.healthy).toBe(true);
      expect(health.replicationLag).toBeNull();
      expect(mockMySQLProvider.getReplicationStatus).not.toHaveBeenCalled();
    });

    it('should handle unreachable instances', async () => {
      mockMySQLProvider.ping.mockResolvedValue(false);

      const health = await service.checkInstanceHealth('unreachable', 3306, true);

      expect(health.healthy).toBe(false);
    });
  });

  describe('getProxySQLHealth', () => {
    it('should check ProxySQL connectivity', async () => {
      mockProxySQLProvider.ping.mockResolvedValue(true);
      mockProxySQLProvider.getWriters.mockResolvedValue([{ hostname: 'primary', port: 3306 }]);
      mockProxySQLProvider.getReaders.mockResolvedValue([]);

      const proxysqlHealth = await service.getProxySQLHealth();

      expect(proxysqlHealth.healthy).toBe(true);
      expect(proxysqlHealth.message).toContain('healthy');
    });

    it('should detect no writers', async () => {
      mockProxySQLProvider.ping.mockResolvedValue(true);
      mockProxySQLProvider.getWriters.mockResolvedValue([]);
      mockProxySQLProvider.getReaders.mockResolvedValue([]);

      const proxysqlHealth = await service.getProxySQLHealth();

      expect(proxysqlHealth.healthy).toBe(false);
      expect(proxysqlHealth.message).toContain('No writers');
    });

    it('should warn on multiple writers', async () => {
      mockProxySQLProvider.ping.mockResolvedValue(true);
      mockProxySQLProvider.getWriters.mockResolvedValue([
        { hostname: 'primary-1', port: 3306 },
        { hostname: 'primary-2', port: 3306 },
      ]);
      mockProxySQLProvider.getReaders.mockResolvedValue([]);

      const proxysqlHealth = await service.getProxySQLHealth();

      expect(proxysqlHealth.healthy).toBe(false);
      expect(proxysqlHealth.message).toContain('Multiple writers');
    });

    it('should handle ping failure', async () => {
      mockProxySQLProvider.ping.mockResolvedValue(false);

      const proxysqlHealth = await service.getProxySQLHealth();

      expect(proxysqlHealth.healthy).toBe(false);
      expect(proxysqlHealth.message).toContain('not responding');
    });
  });

  describe('getTopologyHealth', () => {
    it('should check topology health', async () => {
      const topologyHealth = await service.getTopologyHealth();

      expect(topologyHealth.healthy).toBe(true);
      expect(topologyHealth.message).toContain('healthy');
    });

    it('should detect missing primary', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: null,
        replicas: [],
        problems: [],
        lastUpdated: new Date(),
      });

      const topologyHealth = await service.getTopologyHealth();

      expect(topologyHealth.healthy).toBe(false);
      expect(topologyHealth.message).toContain('No primary');
    });

    it('should report critical problems', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: mockInstance,
        replicas: [],
        problems: [{
          type: 'broken_replication',
          severity: 'critical',
          instance: 'replica-1',
          message: 'Replication broken',
          detectedAt: new Date(),
        }],
        lastUpdated: new Date(),
      });

      const topologyHealth = await service.getTopologyHealth();

      expect(topologyHealth.healthy).toBe(false);
      expect(topologyHealth.message).toContain('critical');
    });
  });

  describe('getReplicationStatus', () => {
    it('should return replication status for all replicas', async () => {
      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      const status = await service.getReplicationStatus();

      expect(status.primary).toContain('mysql-primary');
      expect(status.replicas.length).toBe(1);
      expect(status.replicas[0].lag).toBe(0);
      expect(status.replicas[0].ioRunning).toBe(true);
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetHealthService();
  });

  afterEach(() => {
    resetHealthService();
  });

  it('should create singleton instance', () => {
    // Need to mock providers first
    vi.doMock('../../src/providers/mysql.js', () => ({
      getMySQLProvider: vi.fn(() => createMockMySQLProvider()),
    }));
    vi.doMock('../../src/providers/proxysql.js', () => ({
      getProxySQLProvider: vi.fn(() => createMockProxySQLProvider()),
    }));
    vi.doMock('../../src/services/topology.js', () => ({
      getTopologyService: vi.fn(() => mockTopologyService),
    }));

    const service = getHealthService();
    expect(service).toBeInstanceOf(HealthService);

    const same = getHealthService();
    expect(same).toBe(service);
  });

  it('should reset singleton', () => {
    resetHealthService();
    // After reset, a new instance should be created
    const newService = getHealthService();
    expect(newService).toBeInstanceOf(HealthService);
  });
});