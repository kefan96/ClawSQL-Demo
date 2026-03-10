/**
 * Test fixtures - sample data for tests
 */

import type { Instance, ReplicationStatus, MasterStatus, SlaveHost } from '../../src/types/mysql.js';
import type { Topology, Problem, InstanceWithReplication } from '../../src/types/topology.js';
import type { FailoverCandidate } from '../../src/types/failover.js';
import type { Server, PoolStats } from '../../src/types/proxysql.js';

export const mockInstance: Instance = {
  host: 'mysql-primary',
  port: 3306,
  serverId: 1,
  version: '8.0.35',
  readOnly: false,
  isPrimary: true,
  isReplica: false,
  lastSeen: new Date('2024-01-15T10:00:00Z'),
};

export const mockReplicaInstance: Instance = {
  host: 'mysql-replica-1',
  port: 3306,
  serverId: 2,
  version: '8.0.35',
  readOnly: true,
  isPrimary: false,
  isReplica: true,
  lastSeen: new Date('2024-01-15T10:00:00Z'),
};

export const mockReplicationStatus: ReplicationStatus = {
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

export const mockMasterStatus: MasterStatus = {
  file: 'mysql-bin.000003',
  position: 727,
  gtidsExecuted: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5',
};

export const mockSlaveHosts: SlaveHost[] = [
  { serverId: 2, host: 'mysql-replica-1', port: 3306, masterId: 1 },
  { serverId: 3, host: 'mysql-replica-2', port: 3306, masterId: 1 },
];

export const mockInstanceWithReplication: InstanceWithReplication = {
  ...mockReplicaInstance,
  replication: mockReplicationStatus,
};

export const mockTopology: Topology = {
  clusterName: 'test-cluster',
  primary: mockInstance,
  replicas: [mockInstanceWithReplication],
  problems: [],
  lastUpdated: new Date('2024-01-15T10:00:00Z'),
};

export const mockProblem: Problem = {
  type: 'replication_lag',
  severity: 'warning',
  instance: 'mysql-replica-1:3306',
  message: 'Replication lag: 10s behind master',
  detectedAt: new Date('2024-01-15T10:00:00Z'),
  details: { lag: 10 },
};

export const mockFailoverCandidate: FailoverCandidate = {
  host: 'mysql-replica-1',
  port: 3306,
  score: 100,
  reasons: [],
  gtidPosition: '3E11FA47-71CA-11E1-9E33-C80AA9429562:1-5',
  lag: 0,
  healthy: true,
};

export const mockProxySQLServer: Server = {
  hostgroupId: 10,
  hostname: 'mysql-primary',
  port: 3306,
  status: 'ONLINE',
  weight: 1000,
  maxConnections: 200,
  useSsl: false,
  maxLatencyMs: 0,
  comment: '',
};

export const mockPoolStats: PoolStats = {
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
};

export const mockConfig = {
  cluster: {
    name: 'test-cluster',
    seeds: ['mysql-primary:3306'],
  },
  mysql: {
    user: 'root',
    password: 'test_password',
    connectionPool: 10,
    connectTimeout: 5000,
  },
  proxysql: {
    host: 'proxysql',
    adminPort: 6032,
    dataPort: 6033,
    user: 'admin',
    password: 'admin',
    hostgroups: {
      writer: 10,
      reader: 20,
    },
  },
  failover: {
    enabled: true,
    autoFailover: false,
    failoverTimeout: 30,
    recoveryTimeout: 60,
    minReplicas: 1,
    maxLagSeconds: 5,
  },
  ai: {
    provider: 'anthropic' as const,
    apiKey: 'test-key',
    model: 'claude-sonnet-4-6',
    features: {
      analysis: true,
      recommendations: true,
      naturalLanguage: true,
    },
  },
  sql: {
    readOnly: true,
    maxRows: 1000,
    timeout: 30000,
  },
  memory: {
    enabled: true,
    path: ':memory:',
  },
  scheduler: {
    topologyPollInterval: 5000,
    healthCheckInterval: 3000,
    replicationMonitorInterval: 2000,
  },
  webhooks: {
    enabled: true,
    endpoints: [],
  },
  api: {
    port: 8080,
    host: '0.0.0.0',
  },
  logging: {
    level: 'info' as const,
    format: 'json' as const,
  },
};