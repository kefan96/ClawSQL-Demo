/**
 * Failover Types
 */

export interface SwitchoverCheck {
  canSwitchover: boolean;
  reasons: string[];
  warnings: string[];
  suggestedTarget: string | null;
}

export interface SwitchoverResult {
  success: boolean;
  oldPrimary: string;
  newPrimary: string;
  duration: number;
  message: string;
  proxySQLUpdated: boolean;
  replicationReconfigured: boolean;
  timestamp: Date;
}

export interface FailoverResult {
  success: boolean;
  oldPrimary: string | null;
  newPrimary: string;
  duration: number;
  message: string;
  reason: string;
  proxySQLUpdated: boolean;
  replicationReconfigured: boolean;
  timestamp: Date;
}

export interface PromoteResult {
  success: boolean;
  host: string;
  port: number;
  message: string;
  timestamp: Date;
}

export interface RollbackResult {
  success: boolean;
  restoredPrimary: string;
  message: string;
  timestamp: Date;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FailoverCandidate {
  host: string;
  port: number;
  score: number;
  reasons: string[];
  gtidPosition: string;
  lag: number;
  healthy: boolean;
}

export interface FailoverState {
  inProgress: boolean;
  type: 'switchover' | 'failover' | null;
  startedAt: Date | null;
  oldPrimary: string | null;
  targetPrimary: string | null;
  step: string;
  error: string | null;
}

export interface PreviousTopology {
  primary: string;
  replicas: string[];
  timestamp: Date;
  reason: string;
}