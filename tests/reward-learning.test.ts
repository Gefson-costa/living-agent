import { describe, it, expect, beforeEach } from 'vitest';
import {
  snapshotBirthWeights,
  computeRewardSignal,
  rewardModulatedUpdate,
  decayTowardBirth,
  lamarckianTransfer,
  learningMagnitude,
} from '../src/learning/reward-learning.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import type { Strategy, AgentConfig } from '../src/core/types.js';

const config: AgentConfig = {
  strategyCount: 16, mutationRate: 1.0,
  promptStyleDim: 4, toolCount: 2, noveltyWeight: 0.5,
  elitismRate: 0.1, cullThreshold: -2, taskBatchSize: 8,
  rescueThreshold: 0.15, toolNames: ['a', 'b'],
  systemPromptTemplate: 'test',
};

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  const genome = createGenome(config);
  return {
    genome,
    fitness: 0,
    age: 0,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(),
    ...overrides,
  };
}

describe('snapshotBirthWeights', () => {
  beforeEach(() => resetGenomeCounter());

  it('creates a copy of current promptStyle and toolPreferences', () => {
    const strategy = makeStrategy();
    snapshotBirthWeights(strategy);

    expect(strategy.birthWeights).not.toBeNull();
    expect(strategy.birthWeights!.promptStyle.length).toBe(config.promptStyleDim);
    expect(strategy.birthWeights!.toolPreferences.length).toBe(config.toolCount);
  });

  it('snapshot is independent of later genome changes', () => {
    const strategy = makeStrategy();
    snapshotBirthWeights(strategy);

    const origValue = strategy.birthWeights!.promptStyle[0];
    strategy.genome.promptStyle[0] = origValue + 999;

    expect(strategy.birthWeights!.promptStyle[0]).toBe(origValue);
  });
});

describe('computeRewardSignal', () => {
  it('returns 1.0 for zero fitness delta', () => {
    expect(computeRewardSignal(5, 5)).toBe(1.0);
  });

  it('returns > 1 for positive fitness delta', () => {
    const signal = computeRewardSignal(8, 5);
    expect(signal).toBeGreaterThan(1.0);
  });

  it('returns < 1 for negative fitness delta', () => {
    const signal = computeRewardSignal(3, 5);
    expect(signal).toBeLessThan(1.0);
  });

  it('negative delta is penalized more than equivalent positive (Kahneman-Tversky)', () => {
    const posSignal = computeRewardSignal(5.05, 5); // delta = +0.05
    const negSignal = computeRewardSignal(4.95, 5); // delta = -0.05
    // Loss should be further from 1.0 than gain (1.5x)
    const posDeviation = posSignal - 1.0;
    const negDeviation = 1.0 - negSignal;
    expect(negDeviation).toBeCloseTo(posDeviation * 1.5, 5);
  });

  it('clamps to range 0.2..4.0', () => {
    const highSignal = computeRewardSignal(1000, 0);
    expect(highSignal).toBeCloseTo(4.0, 5);

    const lowSignal = computeRewardSignal(0, 1000);
    expect(lowSignal).toBeCloseTo(0.2, 5);
  });
});

describe('rewardModulatedUpdate', () => {
  beforeEach(() => resetGenomeCounter());

  it('does nothing without birth weights', () => {
    const strategy = makeStrategy();
    strategy.taskHistory = [{ taskId: 't1', strategyId: 's1', score: 0.9, tokensUsed: 10, latencyMs: 50, response: '4', success: true, taskType: 'math' }];
    const before = new Float32Array(strategy.genome.promptStyle);

    rewardModulatedUpdate(strategy, 0);

    expect(strategy.genome.promptStyle).toEqual(before);
  });

  it('does nothing with zero learning rate', () => {
    const strategy = makeStrategy();
    strategy.genome.learningRate = 0;
    snapshotBirthWeights(strategy);
    strategy.taskHistory = [{ taskId: 't1', strategyId: 's1', score: 0.9, tokensUsed: 10, latencyMs: 50, response: '4', success: true, taskType: 'math' }];
    const before = new Float32Array(strategy.genome.promptStyle);

    rewardModulatedUpdate(strategy, 0);

    expect(strategy.genome.promptStyle).toEqual(before);
  });

  it('does nothing with empty task history', () => {
    const strategy = makeStrategy();
    snapshotBirthWeights(strategy);
    const before = new Float32Array(strategy.genome.promptStyle);

    rewardModulatedUpdate(strategy, 0);

    expect(strategy.genome.promptStyle).toEqual(before);
  });

  it('modifies promptStyle after high-scoring task', () => {
    const strategy = makeStrategy();
    strategy.genome.learningRate = 0.02;
    snapshotBirthWeights(strategy);
    strategy.taskHistory = [{ taskId: 't1', strategyId: 's1', score: 0.9, tokensUsed: 10, latencyMs: 50, response: '4', success: true, taskType: 'math' }];
    strategy.fitness = 5;

    const before = new Float32Array(strategy.genome.promptStyle);
    rewardModulatedUpdate(strategy, 0);

    // At least one value should have changed
    let changed = false;
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== strategy.genome.promptStyle[i]) { changed = true; break; }
    }
    expect(changed).toBe(true);
  });

  it('keeps promptStyle in bounds [-1, 1]', () => {
    const strategy = makeStrategy();
    strategy.genome.learningRate = 0.04;
    strategy.genome.promptStyle[0] = 0.99;
    snapshotBirthWeights(strategy);
    strategy.taskHistory = [{ taskId: 't1', strategyId: 's1', score: 1.0, tokensUsed: 10, latencyMs: 50, response: '4', success: true, taskType: 'math' }];
    strategy.fitness = 100;

    for (let i = 0; i < 20; i++) {
      rewardModulatedUpdate(strategy, 0);
    }

    for (let i = 0; i < strategy.genome.promptStyle.length; i++) {
      expect(strategy.genome.promptStyle[i]).toBeGreaterThanOrEqual(-1);
      expect(strategy.genome.promptStyle[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('decayTowardBirth', () => {
  beforeEach(() => resetGenomeCounter());

  it('does nothing without birth weights', () => {
    const strategy = makeStrategy();
    const before = new Float32Array(strategy.genome.promptStyle);

    decayTowardBirth(strategy);

    expect(strategy.genome.promptStyle).toEqual(before);
  });

  it('pulls values toward birth weights', () => {
    const strategy = makeStrategy();
    strategy.genome.learningRate = 0.02;
    snapshotBirthWeights(strategy);

    // Manually drift genome away from birth
    const birthVal = strategy.birthWeights!.promptStyle[0];
    strategy.genome.promptStyle[0] = birthVal + 0.5;

    decayTowardBirth(strategy);

    // Should be closer to birth after decay
    const afterDecay = strategy.genome.promptStyle[0];
    expect(Math.abs(afterDecay - birthVal)).toBeLessThan(0.5);
  });
});

describe('lamarckianTransfer', () => {
  beforeEach(() => resetGenomeCounter());

  it('does nothing without parent birth weights', () => {
    const parent = makeStrategy();
    const childGenome = createGenome(config);
    const before = new Float32Array(childGenome.promptStyle);

    lamarckianTransfer(parent, childGenome);

    expect(childGenome.promptStyle).toEqual(before);
  });

  it('does nothing with zero lamarckian rate', () => {
    const parent = makeStrategy();
    parent.genome.lamarckianRate = 0;
    snapshotBirthWeights(parent);
    parent.genome.promptStyle[0] += 0.5; // simulate learning

    const childGenome = createGenome(config);
    const before = new Float32Array(childGenome.promptStyle);

    lamarckianTransfer(parent, childGenome);

    expect(childGenome.promptStyle).toEqual(before);
  });

  it('transfers learned deltas to child genome', () => {
    const parent = makeStrategy();
    parent.genome.lamarckianRate = 0.1;
    snapshotBirthWeights(parent);

    // Simulate parent learning: drift promptStyle
    parent.genome.promptStyle[0] = parent.birthWeights!.promptStyle[0] + 0.5;

    const childGenome = createGenome(config);
    const childBefore = childGenome.promptStyle[0];

    lamarckianTransfer(parent, childGenome);

    // Child should have shifted toward parent's learned direction
    const childAfter = childGenome.promptStyle[0];
    expect(childAfter).not.toBe(childBefore);
    expect(childAfter).toBeGreaterThan(childBefore); // positive delta transferred
  });

  it('keeps child values in bounds', () => {
    const parent = makeStrategy();
    parent.genome.lamarckianRate = 0.15;
    snapshotBirthWeights(parent);
    parent.genome.promptStyle[0] = 1.0; // max drift
    parent.birthWeights!.promptStyle[0] = -1.0; // max birth

    const childGenome = createGenome(config);
    childGenome.promptStyle[0] = 0.95;

    lamarckianTransfer(parent, childGenome);

    expect(childGenome.promptStyle[0]).toBeLessThanOrEqual(1);
    expect(childGenome.promptStyle[0]).toBeGreaterThanOrEqual(-1);
  });
});

describe('learningMagnitude', () => {
  beforeEach(() => resetGenomeCounter());

  it('returns 0 without birth weights', () => {
    const strategy = makeStrategy();
    expect(learningMagnitude(strategy)).toBe(0);
  });

  it('returns 0 when genome matches birth weights', () => {
    const strategy = makeStrategy();
    snapshotBirthWeights(strategy);
    expect(learningMagnitude(strategy)).toBeCloseTo(0, 5);
  });

  it('increases as genome drifts from birth', () => {
    const strategy = makeStrategy();
    snapshotBirthWeights(strategy);

    strategy.genome.promptStyle[0] += 0.5;
    const mag1 = learningMagnitude(strategy);

    strategy.genome.promptStyle[1] += 0.3;
    const mag2 = learningMagnitude(strategy);

    expect(mag1).toBeGreaterThan(0);
    expect(mag2).toBeGreaterThan(mag1);
  });

  it('includes tool preference drift', () => {
    const strategy = makeStrategy();
    snapshotBirthWeights(strategy);

    strategy.genome.toolPreferences[0] = strategy.birthWeights!.toolPreferences[0] + 0.2;
    const mag = learningMagnitude(strategy);
    expect(mag).toBeGreaterThan(0);
  });
});
