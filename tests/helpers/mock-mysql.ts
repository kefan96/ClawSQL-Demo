/**
 * Mock MySQL Provider
 *
 * Provides a mock implementation of MySQLProvider for unit tests.
 */

import { vi } from 'vitest';
import type { Instance, ReplicationStatus, MasterStatus, SlaveHost, ProcesslistEntry } from '../../src/types/mysql.js';

export function createMockMySQLProvider() {
  return {
    getInstance: vi.fn(async (host: string, port: number = 3306): Promise<Instance> => ({
      host,
      port,
      serverId: 1,
      version: '8.0.35',
      readOnly: host.includes('replica'),
      isPrimary: !host.includes('replica'),
      isReplica: host.includes('replica'),
      lastSeen: new Date(),
    })),

    discoverInstances: vi.fn(async (seeds: string[]): Promise<Instance[]> => {
      const instances: Instance[] = [];
      for (const seed of seeds) {
        const [host, portStr] = seed.split(':');
        const port = portStr ? parseInt(portStr, 10) : 3306;
        instances.push({
          host: host ?? 'localhost',
          port,
          serverId: 1,
          version: '8.0.35',
          readOnly: host?.includes('replica') ?? false,
          isPrimary: !host?.includes('replica'),
          isReplica: host?.includes('replica') ?? false,
          lastSeen: new Date(),
        });
      }
      return instances;
    }),

    getReplicationStatus: vi.fn(async (host: string, port: number = 3306): Promise<ReplicationStatus | null> => {
      if (!host.includes('replica')) {
        return null;
      }
      return {
        ioThreadRunning: true,
        sqlThreadRunning: true,
        secondsBehindMaster: 0,
        masterHost: 'mysql-primary',
        masterPort: 3306,
        gtidsExecuted: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5',
        gtidsPurged: '',
        relayMasterLog: 'mysql-bin.000003',
        execMasterLogPos: 727,
        readMasterLogPos: 727,
      };
    }),

    getMasterStatus: vi.fn(async (host: string, port: number = 3306): Promise<MasterStatus | null> => {
      if (host.includes('replica')) {
        return null;
      }
      return {
        file: 'mysql-bin.000003',
        position: 727,
        gtidsExecuted: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5',
      };
    }),

    getSlaveHosts: vi.fn(async (host: string, port: number = 3306): Promise<SlaveHost[]> => {
      if (host.includes('replica')) {
        return [];
      }
      return [
        { serverId: 2, host: 'mysql-replica-1', port: 3306, masterId: 1 },
        { serverId: 3, host: 'mysql-replica-2', port: 3306, masterId: 1 },
      ];
    }),

    ping: vi.fn(async (host: string, port: number = 3306): Promise<boolean> => true),

    getVersion: vi.fn(async (host: string, port: number = 3306): Promise<string> => '8.0.35'),

    getProcesslist: vi.fn(async (host: string, port: number = 3306): Promise<ProcesslistEntry[]> => []),

    setReadOnly: vi.fn(async (host: string, port: number, readOnly: boolean): Promise<void> => {}),

    getGTIDExecuted: vi.fn(async (host: string, port: number = 3306): Promise<string> =>
      '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5'
    ),

    waitForGTID: vi.fn(async (host: string, port: number, targetGTID: string, timeoutMs: number = 30000): Promise<boolean> =>
      true
    ),

    promoteToPrimary: vi.fn(async (host: string, port: number = 3306): Promise<void> => {}),

    demoteToReplica: vi.fn(async (host: string, port: number, newPrimaryHost: string, newPrimaryPort: number = 3306): Promise<void> => {}),

    setupReplication: vi.fn(async (
      replicaHost: string,
      replicaPort: number,
      primaryHost: string,
      primaryPort: number,
      replicationUser?: string,
      replicationPassword?: string
    ): Promise<void> => {}),

    startSlave: vi.fn(async (host: string, port: number = 3306): Promise<void> => {}),

    stopSlave: vi.fn(async (host: string, port: number = 3306): Promise<void> => {}),

    destroy: vi.fn(async (): Promise<void> => {}),
  };
}

export type MockMySQLProvider = ReturnType<typeof createMockMySQLProvider>;