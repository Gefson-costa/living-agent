import { describe, it, expect, beforeEach } from 'vitest';
import { PopulationRollback, resetSnapshotCounter } from '../../src/safety/rollback.js';
import { createGenome } from '../../src/evolution/genome.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import type { Strategy, AgentConfig } from '../../src/core/types.js';

const TEST_CONFIG: AgentConfig = {
  strategyCount: 4,
  mutationRate: 1.0,
  promptStyleDim: 4,
  toolCount: 2,
  noveltyWeight: 0.8,
  elitismRate: 0.1,
  cullThreshold: -2,
  taskBatchSize: 1,
  rescueThreshold: 0.15,
  toolNames: ['search', 'code'],
  systemPromptTemplate: 'test',
};

function createTestStrategy(fitness = 0.5): Strategy {
  const genome = createGenome(TEST_CONFIG);
  return {
    genome,
    fitness,
    age: 1,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map([['coding', 0.7], ['analysis', 0.3]]),
  };
}

describe('PopulationRollback', () => {
  let rollback: PopulationRollback;

  beforeEach(() => {
    resetGenomeCounter();
    resetSnapshotCounter();
    rollback = new PopulationRollback(5);
  });

  // ── Snapshot ──────────────────────────────────────────

  it('creates a snapshot', () => {
    const strategies = [createTestStrategy(0.6), createTestStrategy(0.4)];
    const id = rollback.snapshot(strategies, 'test');
    expect(id).toContain('snap_');
    expect(rollback.size).toBe(1);
  });

  it('multiple snapshots have distinct IDs', () => {
    const strategies = [createTestStrategy()];
    const id1 = rollback.snapshot(strategies, 'a');
    const id2 = rollback.snapshot(strategies, 'b');
    expect(id1).not.toBe(id2);
    expect(rollback.size).toBe(2);
  });

  it('snapshot records average fitness', () => {
    const strategies = [createTestStrategy(0.8), createTestStrategy(0.4)];
    rollback.snapshot(strategies, 'test');
    const latest = rollback.getLatestSnapshot();
    expect(latest).not.toBeNull();
    expect(latest!.avgFitness).toBeCloseTo(0.6, 5);
  });

  // ── Restore ──────────────────────────────────────────

  it('restores strategies from snapshot', () => {
    const strategies = [createTestStrategy(0.7), createTestStrategy(0.3)];
    const id = rollback.snapshot(strategies, 'test');

    const restored = rollback.restore(id);
    expect(restored).not.toBeNull();
    const { strategies: restoredStrats } = restored!;
    expect(restoredStrats.length).toBe(2);
    expect(restoredStrats[0].fitness).toBeCloseTo(0.7, 5);
    expect(restoredStrats[1].fitness).toBeCloseTo(0.3, 5);
  });

  it('restored strategies have correct genome types', () => {
    const strategies = [createTestStrategy()];
    const id = rollback.snapshot(strategies, 'test');
    const { strategies: restored } = rollback.restore(id)!;

    expect(restored[0].genome.promptStyle).toBeInstanceOf(Float32Array);
    expect(restored[0].genome.toolPreferences).toBeInstanceOf(Float32Array);
  });

  it('restored strategies preserve taskTypeMemory', () => {
    const strategies = [createTestStrategy()];
    const id = rollback.snapshot(strategies, 'test');
    const { strategies: restored } = rollback.restore(id)!;

    expect(restored[0].taskTypeMemory).toBeInstanceOf(Map);
    expect(restored[0].taskTypeMemory.get('coding')).toBeCloseTo(0.7, 5);
    expect(restored[0].taskTypeMemory.get('analysis')).toBeCloseTo(0.3, 5);
  });

  it('restore returns null for unknown ID', () => {
    expect(rollback.restore('nonexistent')).toBeNull();
  });

  // ── Latest Snapshot ──────────────────────────────────

  it('getLatestSnapshot returns most recent', () => {
    const strategies = [createTestStrategy()];
    rollback.snapshot(strategies, 'first');
    rollback.snapshot(strategies, 'second');

    const latest = rollback.getLatestSnapshot();
    expect(latest).not.toBeNull();
    expect(latest!.label).toBe('second');
  });

  it('getLatestSnapshot returns null when empty', () => {
    expect(rollback.getLatestSnapshot()).toBeNull();
  });

  // ── Degradation Detection ────────────────────────────

  it('detects degradation > 20% over 3 cycles', () => {
    const strategies = [createTestStrategy(1.0)];
    rollback.snapshot(strategies, 'baseline'); // avg = 1.0

    // Simulate 3 cycles of degradation
    expect(rollback.checkDegradation(0.7)).toBe(false); // 30% drop, cycle 1
    expect(rollback.checkDegradation(0.7)).toBe(false); // 30% drop, cycle 2
    expect(rollback.checkDegradation(0.7)).toBe(true);  // 30% drop, cycle 3 → trigger!
  });

  it('does not trigger for small drops', () => {
    const strategies = [createTestStrategy(1.0)];
    rollback.snapshot(strategies, 'baseline');

    expect(rollback.checkDegradation(0.9)).toBe(false); // 10% drop
    expect(rollback.checkDegradation(0.9)).toBe(false);
    expect(rollback.checkDegradation(0.9)).toBe(false); // < 20%, never triggers
  });

  it('resets degradation counter on recovery', () => {
    const strategies = [createTestStrategy(1.0)];
    rollback.snapshot(strategies, 'baseline');

    rollback.checkDegradation(0.7); // cycle 1
    rollback.checkDegradation(0.7); // cycle 2
    rollback.checkDegradation(1.0); // recovery — counter resets
    expect(rollback.checkDegradation(0.7)).toBe(false); // starts over at cycle 1
  });

  it('resetDegradation clears counter', () => {
    const strategies = [createTestStrategy(1.0)];
    rollback.snapshot(strategies, 'baseline');

    rollback.checkDegradation(0.7);
    rollback.checkDegradation(0.7);
    rollback.resetDegradation();
    expect(rollback.checkDegradation(0.7)).toBe(false); // counter was reset
  });

  // ── Pruning ──────────────────────────────────────────

  it('prune keeps only last N snapshots', () => {
    const strategies = [createTestStrategy()];
    for (let i = 0; i < 10; i++) {
      rollback.snapshot(strategies, `s${i}`);
    }

    // maxSnapshots is 5 (from constructor)
    expect(rollback.size).toBe(5);
  });

  it('getSnapshotIds returns IDs in order', () => {
    const strategies = [createTestStrategy()];
    const id1 = rollback.snapshot(strategies, 'a');
    const id2 = rollback.snapshot(strategies, 'b');

    const ids = rollback.getSnapshotIds();
    expect(ids[0]).toBe(id1);
    expect(ids[1]).toBe(id2);
  });
});
