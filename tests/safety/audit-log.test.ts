import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLog } from '../../src/safety/audit-log.js';
import type { AuditEntry } from '../../src/core/types.js';

describe('AuditLog', () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog();
  });

  function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
    return AuditLog.createEntry('mutation', 'test entry', overrides);
  }

  // ── Logging ──────────────────────────────────────────────

  it('log adds an entry', () => {
    log.log(makeEntry());
    expect(log.size).toBe(1);
  });

  it('accumulates entries without limit', () => {
    for (let i = 0; i < 100; i++) {
      log.log(makeEntry({ description: `entry ${i}` }));
    }
    expect(log.size).toBe(100);
  });

  // ── Retrieval ──────────────────────────────────────────

  it('getEntries returns all entries (most recent first)', () => {
    log.log(makeEntry({ description: 'first' }));
    log.log(makeEntry({ description: 'second' }));
    const entries = log.getEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].description).toBe('second');
    expect(entries[1].description).toBe('first');
  });

  it('getEntries filters by type', () => {
    log.log(makeEntry({ type: 'mutation' }));
    log.log(makeEntry({ type: 'rollback' }));
    log.log(makeEntry({ type: 'mutation' }));

    const mutations = log.getEntries({ type: 'mutation' });
    expect(mutations.length).toBe(2);
    expect(mutations.every(e => e.type === 'mutation')).toBe(true);
  });

  it('getEntries filters by timestamp', () => {
    log.log(makeEntry({ timestamp: 1000 }));
    log.log(makeEntry({ timestamp: 2000 }));
    log.log(makeEntry({ timestamp: 3000 }));

    const recent = log.getEntries({ since: 2000 });
    expect(recent.length).toBe(2);
  });

  it('getEntries applies limit', () => {
    for (let i = 0; i < 10; i++) {
      log.log(makeEntry());
    }
    const limited = log.getEntries({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  it('getRecentEntries returns last N', () => {
    log.log(makeEntry({ description: 'a' }));
    log.log(makeEntry({ description: 'b' }));
    log.log(makeEntry({ description: 'c' }));

    const recent = log.getRecentEntries(2);
    expect(recent.length).toBe(2);
    expect(recent[0].description).toBe('c');
    expect(recent[1].description).toBe('b');
  });

  // ── Immutability ───────────────────────────────────────

  it('entries are frozen (immutable)', () => {
    log.log(makeEntry({ description: 'original' }));
    const entries = log.getEntries();
    expect(() => {
      (entries[0] as any).description = 'modified';
    }).toThrow();
  });

  // ── createEntry helper ─────────────────────────────────

  it('createEntry provides sensible defaults', () => {
    const entry = AuditLog.createEntry('rollback', 'test rollback');
    expect(entry.type).toBe('rollback');
    expect(entry.description).toBe('test rollback');
    expect(entry.strategyId).toBe('');
    expect(entry.fitnessBefore).toBe(0);
    expect(entry.fitnessAfter).toBeNull();
    expect(entry.tokensUsed).toBe(0);
    expect(entry.approved).toBe(true);
    expect(entry.rollbackId).toBeNull();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('createEntry allows overrides', () => {
    const entry = AuditLog.createEntry('mutation', 'test', {
      strategyId: 'strat_1',
      fitnessBefore: 0.8,
      tokensUsed: 500,
    });
    expect(entry.strategyId).toBe('strat_1');
    expect(entry.fitnessBefore).toBe(0.8);
    expect(entry.tokensUsed).toBe(500);
  });

  // ── Serialization ──────────────────────────────────────

  it('toJSONL and fromJSONL roundtrip', () => {
    log.log(makeEntry({ description: 'entry1', type: 'mutation' }));
    log.log(makeEntry({ description: 'entry2', type: 'rollback' }));

    const jsonl = log.toJSONL();
    const restored = AuditLog.fromJSONL(jsonl);

    expect(restored.size).toBe(2);
    const entries = restored.getEntries();
    expect(entries[0].type).toBe('rollback');
    expect(entries[1].type).toBe('mutation');
  });

  it('fromJSONL handles empty string', () => {
    const restored = AuditLog.fromJSONL('');
    expect(restored.size).toBe(0);
  });

  it('fromJSONL skips malformed lines', () => {
    const jsonl = '{"type":"mutation","description":"ok","timestamp":1}\nnot json\n{"type":"rollback","description":"ok2","timestamp":2}';
    const restored = AuditLog.fromJSONL(jsonl);
    expect(restored.size).toBe(2);
  });
});
