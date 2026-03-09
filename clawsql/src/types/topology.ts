/**
 * Topology Types
 */

import type { Instance, ReplicationStatus } from './mysql.js';

export interface Topology {
  clusterName: string;
  primary: Instance | null;
  replicas: InstanceWithReplication[];
  problems: Problem[];
  lastUpdated: Date;
}

export interface Problem {
  type: ProblemType;
  severity: 'warning' | 'error' | 'critical';
  instance: string;
  message: string;
  detectedAt: Date;
  details?: Record<string, unknown>;
}

export type ProblemType =
  | 'multi_master'
  | 'broken_replication'
  | 'replication_lag'
  | 'no_primary'
  | 'orphaned_replica'
  | 'unreachable'
  | 'stale_topology';

export interface InstanceWithReplication extends Instance {
  replication: ReplicationStatus | null;
}

export interface TopologyAnalysis {
  healthy: boolean;
  primary: string | null;
  replicaCount: number;
  problems: Problem[];
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface TopologyDiff {
  added: string[];
  removed: string[];
  changed: string[];
  primaryChanged: boolean;
  oldPrimary: string | null;
  newPrimary: string | null;
}