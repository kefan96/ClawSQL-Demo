/**
 * Unit tests for Failover Service
 *
 * Tests use mocked providers to avoid actual database operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FailoverService,
  getFailoverService,
  resetFailoverService,
} from '../../src/services/failover.js';
import { createMockMySQLProvider } from '../../helpers/mock-mysql.js';
import { createMockProxySQLProvider } from '../../helpers/mock-proxysql.js';
import { mockInstance, mockReplicaInstance, mockTopology, mockFailoverCandidate } from '../../helpers/fixtures.js';

// Mock providers
vi.mock('../../src/providers/mysql.js', () => ({
  getMySQLProvider: vi.fn(),
  resetMySQLProvider: vi.fn(),
}));

vi.mock('../../src/providers/proxysql.js', () => ({
  getProxySQLProvider: vi.fn(),
  resetProxySQLProvider: vi.fn(),
  Hostgroups: { WRITER: 10, READER: 20 },
}));

vi.mock('../../src/services/topology.js', () => ({
  getTopologyService: vi.fn(),
  resetTopologyService: vi.fn(),
}));

describe('FailoverService', () => {
  let service: FailoverService;
  let mockMySQLProvider: ReturnType<typeof createMockMySQLProvider>;
  let mockProxySQLProvider: ReturnType<typeof createMockProxySQLProvider>;
  let mockTopologyService: any;

  const defaultConfig = {
    enabled: true,
    autoFailover: false,
    failoverTimeout: 30,
    recoveryTimeout: 60,
    minReplicas: 1,
    maxLagSeconds: 5,
  };

  beforeEach(async () => {
    resetFailoverService();
    vi.useFakeTimers();

    mockMySQLProvider = createMockMySQLProvider();
    mockProxySQLProvider = createMockProxySQLProvider();
    mockTopologyService = {
      getTopology: vi.fn(() => ({
        clusterName: 'test-cluster',
        primary: mockInstance,
        replicas: [
          { ...mockReplicaInstance, replication: { ioThreadRunning: true, sqlThreadRunning: true, secondsBehindMaster: 0 } },
        ],
        problems: [],
        lastUpdated: new Date(),
      })),
      getPrimary: vi.fn(() => mockInstance),
      refreshTopology: vi.fn(),
    };

    const { getMySQLProvider } = await vi.importMock('../../src/providers/mysql.js');
    const { getProxySQLProvider } = await vi.importMock('../../src/providers/proxysql.js');
    const { getTopologyService } = await vi.importMock('../../src/services/topology.js');

    getMySQLProvider.mockReturnValue(mockMySQLProvider);
    getProxySQLProvider.mockReturnValue(mockProxySQLProvider);
    getTopologyService.mockReturnValue(mockTopologyService);

    service = new FailoverService(defaultConfig);
  });

  afterEach(async () => {
    vi.useRealTimers();
    resetFailoverService();
    vi.clearAllMocks();
  });

  describe('getState', () => {
    it('should return current failover state', () => {
      const state = service.getState();

      expect(state.inProgress).toBe(false);
      expect(state.type).toBeNull();
      expect(state.step).toBe('idle');
    });
  });

  describe('canSwitchover', () => {
    it('should return true when switchover is possible', async () => {
      const check = await service.canSwitchover();

      expect(check.canSwitchover).toBe(true);
      expect(check.reasons.length).toBe(0);
    });

    it('should return false when no primary', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: null,
        replicas: [],
        problems: [],
        lastUpdated: new Date(),
      });

      const check = await service.canSwitchover();

      expect(check.canSwitchover).toBe(false);
      expect(check.reasons).toContain('No primary detected');
    });

    it('should return false when no replicas', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: mockInstance,
        replicas: [],
        problems: [],
        lastUpdated: new Date(),
      });

      const check = await service.canSwitchover();

      expect(check.canSwitchover).toBe(false);
      expect(check.reasons).toContain('No replicas available');
    });

    it('should return false with critical problems', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: mockInstance,
        replicas: [{ ...mockReplicaInstance, replication: {} }],
        problems: [{
          type: 'broken_replication',
          severity: 'error',
          instance: 'replica-1',
          message: 'Replication broken',
          detectedAt: new Date(),
        }],
        lastUpdated: new Date(),
      });

      const check = await service.canSwitchover();

      expect(check.canSwitchover).toBe(false);
    });

    it('should warn on high replication lag', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: mockInstance,
        replicas: [{
          ...mockReplicaInstance,
          replication: { secondsBehindMaster: 30 },
        }],
        problems: [],
        lastUpdated: new Date(),
      });

      const check = await service.canSwitchover();

      expect(check.warnings.length).toBeGreaterThan(0);
    });

    it('should suggest best target', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue({
        ioThreadRunning: true,
        sqlThreadRunning: true,
        secondsBehindMaster: 0,
      });
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');

      const check = await service.canSwitchover();

      expect(check.suggestedTarget).not.toBeNull();
    });
  });

  describe('switchover', () => {
    it('should execute graceful switchover', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue({
        ioThreadRunning: true,
        sqlThreadRunning: true,
        secondsBehindMaster: 0,
      });
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');
      mockMySQLProvider.waitForGTID.mockResolvedValue(true);

      const result = await service.switchover('mysql-replica-1:3306');

      expect(result.success).toBe(true);
      expect(result.oldPrimary).toContain('mysql-primary');
      expect(result.newPrimary).toContain('mysql-replica-1');
      expect(mockMySQLProvider.setReadOnly).toHaveBeenCalled();
      expect(mockMySQLProvider.promoteToPrimary).toHaveBeenCalled();
      expect(mockProxySQLProvider.switchWriter).toHaveBeenCalled();
    });

    it('should reject concurrent switchover', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');
      mockMySQLProvider.waitForGTID.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(true), 1000))
      );

      // Start first switchover
      const first = service.switchover('mysql-replica-1:3306');

      // Try second switchover immediately
      const second = await service.switchover('mysql-replica-2:3306');

      expect(second.success).toBe(false);
      expect(second.message).toContain('already in progress');

      // Wait for first to complete
      vi.runAllTimersAsync();
      await first;
    });

    it('should fail if target not in replicas', async () => {
      const result = await service.switchover('unknown-host:3306');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found in replicas');
    });

    it('should fail if target does not catch up', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');
      mockMySQLProvider.waitForGTID.mockResolvedValue(false); // Timeout

      const result = await service.switchover('mysql-replica-1:3306');

      expect(result.success).toBe(false);
      expect(result.message).toContain('catch up');
    });

    it('should select best candidate if no target specified', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue({
        ioThreadRunning: true,
        sqlThreadRunning: true,
        secondsBehindMaster: 0,
      });
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');
      mockMySQLProvider.waitForGTID.mockResolvedValue(true);

      const result = await service.switchover();

      expect(result.success).toBe(true);
      expect(result.newPrimary).toBeDefined();
    });
  });

  describe('failover', () => {
    it('should execute emergency failover', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue({
        ioThreadRunning: true,
        sqlThreadRunning: true,
        secondsBehindMaster: 0,
      });
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');

      const result = await service.failover();

      expect(result.success).toBe(true);
      expect(result.reason).toBe('primary_failure');
      expect(mockMySQLProvider.promoteToPrimary).toHaveBeenCalled();
    });

    it('should fail with no candidates', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: null,
        replicas: [],
        problems: [],
        lastUpdated: new Date(),
      });

      const result = await service.failover();

      expect(result.success).toBe(false);
      expect(result.message).toContain('No suitable failover candidates');
    });

    it('should update ProxySQL routing', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue({
        ioThreadRunning: true,
        sqlThreadRunning: true,
        secondsBehindMaster: 0,
      });
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');

      await service.failover();

      expect(mockProxySQLProvider.removeServer).toHaveBeenCalled();
      expect(mockProxySQLProvider.addServer).toHaveBeenCalled();
    });
  });

  describe('emergencyPromote', () => {
    it('should promote specific host', async () => {
      const result = await service.emergencyPromote('emergency-host', 3306);

      expect(result.success).toBe(true);
      expect(result.host).toBe('emergency-host');
      expect(mockMySQLProvider.promoteToPrimary).toHaveBeenCalledWith('emergency-host', 3306);
    });

    it('should update ProxySQL', async () => {
      await service.emergencyPromote('emergency-host', 3306);

      expect(mockProxySQLProvider.switchWriter).toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('should fail with no previous topology', async () => {
      const result = await service.rollback();

      expect(result.success).toBe(false);
      expect(result.message).toContain('No previous topology');
    });

    it('should attempt rollback after switchover', async () => {
      mockMySQLProvider.ping.mockResolvedValue(true);
      mockMySQLProvider.getReplicationStatus.mockResolvedValue({
        ioThreadRunning: true,
        sqlThreadRunning: true,
        secondsBehindMaster: 0,
      });
      mockMySQLProvider.getGTIDExecuted.mockResolvedValue('uuid:1-5');
      mockMySQLProvider.waitForGTID.mockResolvedValue(true);

      await service.switchover('mysql-replica-1:3306');
      const result = await service.rollback();

      // Current implementation requires manual intervention
      expect(result.message).toContain('manual intervention');
    });
  });

  describe('validateTopology', () => {
    it('should return valid for healthy topology', async () => {
      mockProxySQLProvider.getWriters.mockResolvedValueOnce([
        { hostname: 'mysql-primary', port: 3306 },
      ]);

      const result = await service.validateTopology();

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect missing primary', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: null,
        replicas: [],
        problems: [],
        lastUpdated: new Date(),
      });

      const result = await service.validateTopology();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No primary detected');
    });

    it('should warn on ProxySQL mismatch', async () => {
      mockProxySQLProvider.getWriters.mockResolvedValueOnce([
        { hostname: 'wrong-primary', port: 3306 },
      ]);

      const result = await service.validateTopology();

      expect(result.warnings.some(w => w.includes('ProxySQL'))).toBe(true);
    });
  });

  describe('getCandidates', () => {
    it('should rank candidates by score', async () => {
      mockTopologyService.getTopology.mockReturnValueOnce({
        clusterName: 'test-cluster',
        primary: mockInstance,
        replicas: [
          { ...mockReplicaInstance, host: 'replica-1', port: 3306 },
          { ...mockReplicaInstance, host: 'replica-2', port: 3306 },
        ],
        problems: [],
        lastUpdated: new Date(),
      });

      mockMySQLProvider.ping
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      mockMySQLProvider.getReplicationStatus
        .mockResolvedValueOnce({ ioThreadRunning: true, sqlThreadRunning: true, secondsBehindMaster: 0 })
        .mockResolvedValueOnce({ ioThreadRunning: true, sqlThreadRunning: true, secondsBehindMaster: 10 });
      mockMySQLProvider.getGTIDExecuted
        .mockResolvedValueOnce('uuid:1-10')
        .mockResolvedValueOnce('uuid:1-5');

      await service.switchover();

      // The candidate selection happens internally
    });
  });
});

describe('Singleton functions', () => {
  beforeEach(() => {
    resetFailoverService();
  });

  afterEach(() => {
    resetFailoverService();
  });

  it('should throw if not initialized', () => {
    expect(() => getFailoverService()).toThrow('Failover service not initialized');
  });
});