// ================================================================
//  Audit Log — Append-only record of all agent actions
//
//  Every mutation, self-code patch, tool synthesis, architecture
//  proposal, rollback, and budget event is recorded.
//  The agent CANNOT delete or truncate entries.
// ================================================================

import type { AuditEntry } from '../core/types.js';

export type AuditFilter = {
  type?: AuditEntry['type'];
  since?: number;
  limit?: number;
};

export class AuditLog {
  private entries: AuditEntry[] = [];

  /** Append a new entry to the log. Entries are immutable once added. */
  log(entry: AuditEntry): void {
    // Freeze the entry to prevent mutation after logging
    this.entries.push(Object.freeze({ ...entry }));
  }

  /** Get filtered entries (most recent first) */
  getEntries(filter?: AuditFilter): AuditEntry[] {
    let result = [...this.entries];

    if (filter?.type) {
      result = result.filter(e => e.type === filter.type);
    }
    if (filter?.since !== undefined) {
      result = result.filter(e => e.timestamp >= filter.since!);
    }

    // Most recent first
    result.reverse();

    if (filter?.limit !== undefined && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /** Get the N most recent entries */
  getRecentEntries(count: number): AuditEntry[] {
    return this.getEntries({ limit: count });
  }

  /** Total number of entries */
  get size(): number {
    return this.entries.length;
  }

  /** Export all entries as JSONL string (for persistence) */
  toJSONL(): string {
    return this.entries.map(e => JSON.stringify(e)).join('\n');
  }

  /** Import entries from JSONL string (for loading) */
  static fromJSONL(jsonl: string): AuditLog {
    const log = new AuditLog();
    if (!jsonl.trim()) return log;

    for (const line of jsonl.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as AuditEntry;
        log.entries.push(Object.freeze(entry));
      } catch {
        // Skip malformed lines
      }
    }
    return log;
  }

  /** Create an audit entry with sensible defaults */
  static createEntry(
    type: AuditEntry['type'],
    description: string,
    overrides: Partial<AuditEntry> = {},
  ): AuditEntry {
    return {
      timestamp: Date.now(),
      type,
      strategyId: '',
      description,
      fitnessBefore: 0,
      fitnessAfter: null,
      tokensUsed: 0,
      approved: true,
      rollbackId: null,
      ...overrides,
    };
  }
}
