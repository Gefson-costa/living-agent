import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetTracker } from '../../src/safety/budget-cap.js';

describe('BudgetTracker', () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker({
      maxTokensPerDay: 1000,
      maxCostPerDay: 5.0,
      warningThreshold: 0.8,
      action: 'pause',
    });
  });

  // ── Recording ──────────────────────────────────────────

  it('accumulates tokens correctly', () => {
    tracker.record(100);
    tracker.record(200);
    expect(tracker.getUsage().tokensToday).toBe(300);
  });

  it('accumulates cost correctly', () => {
    tracker.record(100, 1.5);
    tracker.record(200, 0.5);
    expect(tracker.getUsage().costToday).toBe(2.0);
  });

  it('computes percent usage correctly', () => {
    tracker.record(500);
    const usage = tracker.getUsage();
    expect(usage.percentTokens).toBeCloseTo(0.5, 5);
  });

  // ── Budget Check ──────────────────────────────────────

  it('allows usage below limit', () => {
    tracker.record(400);
    const check = tracker.check();
    expect(check.allowed).toBe(true);
    expect(check.warning).toBe(false);
    expect(check.reason).toBeNull();
  });

  it('warns when above warning threshold (80%)', () => {
    tracker.record(850);
    const check = tracker.check();
    expect(check.allowed).toBe(true);
    expect(check.warning).toBe(true);
    expect(check.reason).toContain('warning');
  });

  it('blocks when above 100% token limit', () => {
    tracker.record(1100);
    const check = tracker.check();
    expect(check.allowed).toBe(false);
    expect(check.warning).toBe(true);
    expect(check.reason).toContain('exceeded');
  });

  it('blocks when above 100% cost limit', () => {
    tracker.record(100, 6.0);
    const check = tracker.check();
    expect(check.allowed).toBe(false);
  });

  it('warns based on cost threshold', () => {
    tracker.record(100, 4.5); // 90% of $5 limit
    const check = tracker.check();
    expect(check.allowed).toBe(true);
    expect(check.warning).toBe(true);
  });

  // ── Reset ──────────────────────────────────────────────

  it('reset clears counters', () => {
    tracker.record(500, 3.0);
    tracker.reset();
    const usage = tracker.getUsage();
    expect(usage.tokensToday).toBe(0);
    expect(usage.costToday).toBe(0);
  });

  // ── Default Config ─────────────────────────────────────

  it('uses default config when none provided', () => {
    const defaultTracker = new BudgetTracker();
    defaultTracker.record(100);
    const usage = defaultTracker.getUsage();
    expect(usage.percentTokens).toBeCloseTo(100 / 1_000_000, 8);
  });

  // ── Action ─────────────────────────────────────────────

  it('exposes configured action', () => {
    expect(tracker.action).toBe('pause');
    const killTracker = new BudgetTracker({ action: 'kill' });
    expect(killTracker.action).toBe('kill');
  });

  // ── Edge Cases ─────────────────────────────────────────

  it('handles zero max gracefully', () => {
    const zeroTracker = new BudgetTracker({ maxTokensPerDay: 0, maxCostPerDay: 0 });
    zeroTracker.record(100);
    const usage = zeroTracker.getUsage();
    expect(usage.percentTokens).toBe(0);
    expect(usage.percentCost).toBe(0);
  });

  it('check includes usage in result', () => {
    tracker.record(300, 1.0);
    const check = tracker.check();
    expect(check.usage.tokensToday).toBe(300);
    expect(check.usage.costToday).toBe(1.0);
  });
});
