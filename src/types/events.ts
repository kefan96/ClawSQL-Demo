/**
 * Event Types
 */

import type { SchemaDiff } from './memory.js';

export type EventType =
  | 'topology_change'
  | 'primary_change'
  | 'failover_start'
  | 'failover_complete'
  | 'failover_abort'
  | 'switchover_start'
  | 'switchover_complete'
  | 'switchover_abort'
  | 'replication_lag'
  | 'instance_down'
  | 'instance_up'
  | 'problem_detected'
  | 'problem_resolved'
  | 'schema_change';

export interface ClusterEvent {
  id: string;
  type: EventType;
  timestamp: Date;
  cluster: string;
  details: Record<string, unknown>;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface TopologyChange {
  previousPrimary: string | null;
  newPrimary: string;
  previousReplicas: string[];
  newReplicas: string[];
  reason: string;
  timestamp: Date;
}

export interface FailoverEvent {
  type: 'failover_start' | 'failover_complete' | 'failover_abort';
  oldPrimary: string | null;
  newPrimary: string | null;
  reason: string;
  timestamp: Date;
  duration?: number;
  error?: string;
}

export interface WebhookPayload {
  event: EventType;
  cluster: string;
  timestamp: string;
  data: Record<string, unknown>;
  signature?: string;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  events: EventType[];
  headers?: Record<string, string>;
  retryCount?: number;
  retryDelay?: number;
}

export interface SchemaChangeEvent {
  cluster: string;
  database: string;
  diff: SchemaDiff;
  timestamp: Date;
}

export type EventHandler = (event: ClusterEvent) => void | Promise<void>;

export interface EventBus {
  emit(event: ClusterEvent): void;
  on(type: EventType | '*', handler: EventHandler): void;
  off(type: EventType | '*', handler: EventHandler): void;
}