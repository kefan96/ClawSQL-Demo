/**
 * Mock ProxySQL Provider
 *
 * Provides a mock implementation of ProxySQLProvider for unit tests.
 */

import { vi } from 'vitest';
import type { Server, PoolStats, QueryRule, SyncResult } from '../../src/types/proxysql.js';

export function createMockProxySQLProvider() {
  const servers: Server[] = [
    {
      hostgroupId: 10,
      hostname: 'mysql-primary',
      port: 3306,
      status: 'ONLINE',
      weight: 1000,
      maxConnections: 200,
      useSsl: false,
      maxLatencyMs: 0,
      comment: '',
    },
    {
      hostgroupId: 20,
      hostname: 'mysql-replica-1',
      port: 3306,
      status: 'ONLINE',
      weight: 1000,
      maxConnections: 200,
      useSsl: false,
      maxLatencyMs: 0,
      comment: '',
    },
  ];

  return {
    getServers: vi.fn(async (): Promise<Server[]> => [...servers]),

    getWriters: vi.fn(async (): Promise<Server[]> =>
      servers.filter(s => s.hostgroupId === 10)
    ),

    getReaders: vi.fn(async (): Promise<Server[]> =>
      servers.filter(s => s.hostgroupId === 20)
    ),

    addServer: vi.fn(async (
      hostgroup: number,
      hostname: string,
      port: number = 3306,
      weight: number = 1000,
      maxConnections: number = 200
    ): Promise<void> => {
      servers.push({
        hostgroupId: hostgroup,
        hostname,
        port,
        status: 'ONLINE',
        weight,
        maxConnections,
        useSsl: false,
        maxLatencyMs: 0,
        comment: '',
      });
    }),

    removeServer: vi.fn(async (hostname: string, port: number, hostgroup?: number): Promise<void> => {
      const index = servers.findIndex(s =>
        s.hostname === hostname && s.port === port &&
        (hostgroup === undefined || s.hostgroupId === hostgroup)
      );
      if (index !== -1) {
        servers.splice(index, 1);
      }
    }),

    setServerStatus: vi.fn(async (
      hostname: string,
      port: number,
      hostgroup: number,
      status: 'ONLINE' | 'OFFLINE' | 'SHUNNED'
    ): Promise<void> => {
      const server = servers.find(s =>
        s.hostname === hostname && s.port === port && s.hostgroupId === hostgroup
      );
      if (server) {
        server.status = status;
      }
    }),

    updateServerHostgroup: vi.fn(async (
      hostname: string,
      port: number,
      fromHostgroup: number,
      toHostgroup: number
    ): Promise<void> => {
      const server = servers.find(s =>
        s.hostname === hostname && s.port === port && s.hostgroupId === fromHostgroup
      );
      if (server) {
        server.hostgroupId = toHostgroup;
      }
    }),

    switchWriter: vi.fn(async (
      oldHost: string,
      oldPort: number,
      newHost: string,
      newPort: number
    ): Promise<void> => {
      // Remove old writer from writer HG
      const writerIndex = servers.findIndex(s =>
        s.hostname === oldHost && s.port === oldPort && s.hostgroupId === 10
      );
      if (writerIndex !== -1) {
        servers.splice(writerIndex, 1);
      }

      // Add old writer to reader HG
      servers.push({
        hostgroupId: 20,
        hostname: oldHost,
        port: oldPort,
        status: 'ONLINE',
        weight: 1000,
        maxConnections: 200,
        useSsl: false,
        maxLatencyMs: 0,
        comment: '',
      });

      // Remove new writer from reader HG
      const readerIndex = servers.findIndex(s =>
        s.hostname === newHost && s.port === newPort && s.hostgroupId === 20
      );
      if (readerIndex !== -1) {
        servers.splice(readerIndex, 1);
      }

      // Add new writer to writer HG
      servers.push({
        hostgroupId: 10,
        hostname: newHost,
        port: newPort,
        status: 'ONLINE',
        weight: 1000,
        maxConnections: 200,
        useSsl: false,
        maxLatencyMs: 0,
        comment: '',
      });
    }),

    syncTopology: vi.fn(async (
      primary: string,
      replicas: string[],
      primaryPort: number = 3306
    ): Promise<SyncResult> => ({
      success: true,
      added: [],
      removed: [],
      unchanged: [`${primary}:${primaryPort}`],
      errors: [],
    })),

    getPoolStats: vi.fn(async (): Promise<PoolStats[]> => [
      {
        hostgroupId: 10,
        srvHost: 'mysql-primary',
        srvPort: 3306,
        status: 'ONLINE',
        connUsed: 5,
        connFree: 5,
        connOk: 10,
        connErr: 0,
        queries: 1000,
        bytesDataSent: 50000,
        bytesDataRecv: 100000,
        latencyUs: 1000,
      },
    ]),

    getQueryRules: vi.fn(async (): Promise<QueryRule[]> => []),

    executeSQL: vi.fn(async (
      sql: string,
      database?: string,
      timeout?: number
    ): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number }> => ({
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'test' }],
      rowCount: 1,
    })),

    getSchema: vi.fn(async (database?: string) => ({
      database: database ?? 'test',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'int', nullable: false, key: 'PRI' },
            { name: 'name', type: 'varchar(255)', nullable: true, key: null },
          ],
        },
      ],
    })),

    loadServers: vi.fn(async (): Promise<void> => {}),

    loadQueryRules: vi.fn(async (): Promise<void> => {}),

    ping: vi.fn(async (): Promise<boolean> => true),

    destroy: vi.fn(async (): Promise<void> => {}),
  };
}

export type MockProxySQLProvider = ReturnType<typeof createMockProxySQLProvider>;