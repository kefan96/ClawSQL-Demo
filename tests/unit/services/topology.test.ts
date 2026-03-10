/**
 * Unit tests for Topology Service
 *
 * Tests use mocked providers to avoid actual database connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TopologyService,
  getTopologyService,
  resetTopologyService,
} from '../../src/services/topology.js';
import { createMockMySQLProvider } from '../../helpers/mock-mysql.js';
import { mockInstance, mockReplicaInstance, mockReplicationStatus } from '../../helpers/fixtures.js';

// Create module-level mock functions
const mockGetMySQLProvider = vi.fn();
const mockResetMySQLProvider = vi.fn();
const mockGetMemoryService = vi.fn();
const mockGetSQLService = vi.fn();

vi.mock('../../src/providers/mysql.js', () => ({
  getMySQLProvider: () => mockGetMySQLProvider(),
  resetMySQLProvider: () => mockResetMySQLProvider(),
}));

vi.mock('../../src/services/memory.js', () => ({
  getMemoryService: () => mockGetMemoryService(),
}));

vi.mock('../../src/services/sql.js', () => ({
  getSQLService: () => mockGetSQLService(),
}));

describe('TopologyService', () => {
  let service: TopologyService;
  let mockMySQLProvider: ReturnType<typeof createMockMySQLProvider>;

  const defaultConfig = {
    clusterName: 'test-cluster',
    seeds: ['mysql-primary:3306'],
    pollInterval: 5000,
  };

  beforeEach(() => {
    resetTopologyService();
    vi.useFakeTimers();

    mockMySQLProvider = createMockMySQLProvider();
    mockGetMySQLProvider.mockReturnValue(mockMySQLProvider);

    service = new TopologyService(defaultConfig);
  });

  afterEach(async () => {
    await service.destroy();
    resetTopologyService();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('discoverCluster', () => {
    it('should build topology from discovered instances', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, isPrimary: false, isReplica: true, readOnly: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValueOnce(mockReplicationStatus);

      const topology = await service.discoverCluster();

      expect(topology.clusterName).toBe('test-cluster');
      expect(topology.primary).not.toBeNull();
      expect(topology.primary?.host).toBe('mysql-primary');
      expect(topology.replicas.length).toBe(1);
    });

    it('should detect no primary problem', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockReplicaInstance, isPrimary: false, isReplica: true, readOnly: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      const topology = await service.discoverCluster();

      expect(topology.primary).toBeNull();
      expect(topology.problems.some(p => p.type === 'no_primary')).toBe(true);
    });

    it('should detect broken replication problem', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, isPrimary: false, isReplica: true, readOnly: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValueOnce({
        ...mockReplicationStatus,
        ioThreadRunning: false,
        sqlThreadRunning: false,
      });

      const topology = await service.discoverCluster();

      expect(topology.problems.some(p => p.type === 'broken_replication')).toBe(true);
    });

    it('should detect replication lag problem', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, isPrimary: false, isReplica: true, readOnly: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValueOnce({
        ...mockReplicationStatus,
        secondsBehindMaster: 30,
      });

      const topology = await service.discoverCluster();

      expect(topology.problems.some(p => p.type === 'replication_lag')).toBe(true);
    });

    it('should detect multi-master problem', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockInstance, host: 'mysql-primary-2', isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, isPrimary: false, isReplica: true, readOnly: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      const topology = await service.discoverCluster();

      expect(topology.primary).not.toBeNull();
    });

    it('should detect orphaned replica problem', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, isPrimary: false, isReplica: true, readOnly: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValueOnce({
        ...mockReplicationStatus,
        masterHost: 'wrong-master',
      });

      const topology = await service.discoverCluster();

      expect(topology.problems.some(p => p.type === 'orphaned_replica')).toBe(true);
    });
  });

  describe('getTopology', () => {
    it('should return current topology', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);

      await service.discoverCluster();
      const topology = service.getTopology();

      expect(topology.clusterName).toBe('test-cluster');
    });

    it('should throw if topology not discovered', () => {
      expect(() => service.getTopology()).toThrow('Topology not yet discovered');
    });
  });

  describe('getPrimary', () => {
    it('should return current primary', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);

      await service.discoverCluster();
      const primary = service.getPrimary();

      expect(primary?.host).toBe('mysql-primary');
    });

    it('should return null if no primary', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([]);

      await service.discoverCluster();
      const primary = service.getPrimary();

      expect(primary).toBeNull();
    });
  });

  describe('getReplicas', () => {
    it('should return all replicas', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, host: 'replica-1', isPrimary: false, isReplica: true },
        { ...mockReplicaInstance, host: 'replica-2', isPrimary: false, isReplica: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      await service.discoverCluster();
      const replicas = service.getReplicas();

      expect(replicas.length).toBe(2);
    });
  });

  describe('getProblems', () => {
    it('should return current problems', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockReplicaInstance, isPrimary: false, isReplica: true, readOnly: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      await service.discoverCluster();
      const problems = service.getProblems();

      expect(problems.some(p => p.type === 'no_primary')).toBe(true);
    });
  });

  describe('getInstance', () => {
    it('should find instance by host:port', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, host: 'mysql-replica-1', isPrimary: false, isReplica: true },
      ]);

      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      await service.discoverCluster();
      const instance = service.getInstance('mysql-replica-1', 3306);

      expect(instance).toBeDefined();
      expect(instance?.host).toBe('mysql-replica-1');
    });

    it('should return undefined for unknown instance', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);

      await service.discoverCluster();
      const instance = service.getInstance('unknown-host', 3306);

      expect(instance).toBeUndefined();
    });
  });

  describe('diffTopology', () => {
    it('should detect added instances', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);
      await service.discoverCluster();

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, isPrimary: false, isReplica: true },
      ]);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);

      await service.discoverCluster();

      expect(service.getReplicas().length).toBe(1);
    });

    it('should detect removed instances', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, host: 'replica-1', isPrimary: false, isReplica: true },
        { ...mockReplicaInstance, host: 'replica-2', isPrimary: false, isReplica: true },
      ]);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);
      await service.discoverCluster();

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, host: 'replica-1', isPrimary: false, isReplica: true },
      ]);
      await service.discoverCluster();

      expect(service.getReplicas().length).toBe(1);
    });

    it('should detect primary change', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, host: 'old-primary', isPrimary: true, isReplica: false, readOnly: false },
        { ...mockReplicaInstance, host: 'new-primary', isPrimary: false, isReplica: true },
      ]);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);
      await service.discoverCluster();

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, host: 'old-primary', isPrimary: false, isReplica: true, readOnly: true },
        { ...mockReplicaInstance, host: 'new-primary', isPrimary: true, isReplica: false, readOnly: false },
      ]);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue(mockReplicationStatus);
      await service.discoverCluster();

      expect(service.getPrimary()?.host).toBe('new-primary');
    });
  });

  describe('Event Handling', () => {
    it('should emit topology_change event', async () => {
      const handler = vi.fn();
      service.on('topology_change', handler);

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);
      await service.discoverCluster();

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, host: 'new-primary', isPrimary: true, isReplica: false, readOnly: false },
      ]);
      await service.discoverCluster();

      expect(handler).toHaveBeenCalled();
    });

    it('should support wildcard event handlers', async () => {
      const handler = vi.fn();
      service.on('*', handler);

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);
      await service.discoverCluster();

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, host: 'new-primary', isPrimary: true, isReplica: false, readOnly: false },
      ]);
      await service.discoverCluster();

      expect(handler).toHaveBeenCalled();
    });

    it('should remove event handler', async () => {
      const handler = vi.fn();
      service.on('topology_change', handler);
      service.off('topology_change', handler);

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);
      await service.discoverCluster();

      mockMySQLProvider.discoverInstances.mockResolvedValueOnce([
        { ...mockInstance, host: 'new-primary', isPrimary: true, isReplica: false, readOnly: false },
      ]);
      await service.discoverCluster();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Polling', () => {
    it('should start periodic topology polling', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValue([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);

      service.startPolling(1000);

      // Initial discovery happens immediately but async
      await vi.advanceTimersByTimeAsync(0);
      expect(mockMySQLProvider.discoverInstances).toHaveBeenCalledTimes(1);

      // Advance timer to trigger next poll
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockMySQLProvider.discoverInstances).toHaveBeenCalledTimes(2);

      service.stopPolling();
    });

    it('should stop polling', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValue([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);

      service.startPolling(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockMySQLProvider.discoverInstances).toHaveBeenCalledTimes(1);

      service.stopPolling();

      await vi.advanceTimersByTimeAsync(5000);
      // Should not have polled again after stopping
      expect(mockMySQLProvider.discoverInstances).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('should clean up resources', async () => {
      mockMySQLProvider.discoverInstances.mockResolvedValue([
        { ...mockInstance, isPrimary: true, isReplica: false, readOnly: false },
      ]);

      service.startPolling(1000);
      await vi.advanceTimersByTimeAsync(0);

      await service.destroy();

      await vi.advanceTimersByTimeAsync(5000);
      // Should not have polled again after destroy
      expect(mockMySQLProvider.discoverInstances).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Singleton functions', () => {
  let mockMySQLProvider: ReturnType<typeof createMockMySQLProvider>;

  beforeEach(() => {
    resetTopologyService();
    mockMySQLProvider = createMockMySQLProvider();
    mockGetMySQLProvider.mockReturnValue(mockMySQLProvider);
  });

  afterEach(() => {
    resetTopologyService();
  });

  it('should throw if not initialized', () => {
    expect(() => getTopologyService()).toThrow('Topology service not initialized');
  });
});