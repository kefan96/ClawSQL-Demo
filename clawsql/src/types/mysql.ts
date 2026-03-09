/**
 * MySQL Instance Types
 */

export interface MySQLConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  connectionLimit?: number;
  connectTimeout?: number;
}

export interface Instance {
  host: string;
  port: number;
  serverId: number;
  version: string;
  readOnly: boolean;
  isPrimary: boolean;
  isReplica: boolean;
  lastSeen: Date;
}

export interface ReplicationStatus {
  ioThreadRunning: boolean;
  sqlThreadRunning: boolean;
  secondsBehindMaster: number | null;
  masterHost: string | null;
  masterPort: number | null;
  gtidsExecuted: string;
  gtidsPurged: string;
  relayMasterLog: string | null;
  execMasterLogPos: number | null;
  readMasterLogPos: number | null;
}

export interface MasterStatus {
  file: string;
  position: number;
  gtidsExecuted: string;
}

export interface SlaveHost {
  serverId: number;
  host: string;
  port: number;
  masterId: number;
}

export interface ProcesslistEntry {
  id: number;
  user: string;
  host: string;
  db: string | null;
  command: string;
  time: number;
  state: string | null;
  info: string | null;
}

export interface GTID {
  sourceId: string;
  transactionId: number;
}

export interface GTIDSet {
  uuid: string;
  intervals: Array<[number, number]>;
}

/**
 * Parse GTID string into structured format
 */
export function parseGTID(gtidString: string): GTIDSet[] {
  if (!gtidString) return [];

  const sets: GTIDSet[] = [];
  const parts = gtidString.split(',');

  for (const part of parts) {
    const match = part.trim().match(/^([a-fA-F0-9-]+):(.+)$/);
    if (match && match[1] && match[2]) {
      const uuid = match[1];
      const intervals: Array<[number, number]> = [];
      const rangeParts = match[2].split(':');

      for (const range of rangeParts) {
        if (range.includes('-')) {
          const parts = range.split('-').map(Number);
          const start = parts[0] ?? 0;
          const end = parts[1] ?? 0;
          intervals.push([start, end]);
        } else {
          const num = Number(range);
          intervals.push([num, num]);
        }
      }

      sets.push({ uuid, intervals });
    }
  }

  return sets;
}

/**
 * Check if GTID A includes GTID B (A has all transactions B has)
 */
export function gtidIncludes(gtidA: string, gtidB: string): boolean {
  if (!gtidB) return true;
  if (!gtidA) return false;

  const setsA = parseGTID(gtidA);
  const setsB = parseGTID(gtidB);

  for (const setB of setsB) {
    const setA = setsA.find(s => s.uuid === setB.uuid);
    if (!setA) return false;

    for (const [startB, endB] of setB.intervals) {
      let covered = false;
      for (const [startA, endA] of setA.intervals) {
        if (startA <= startB && endA >= endB) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
  }

  return true;
}