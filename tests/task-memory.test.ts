import { describe, it, expect, beforeEach } from 'vitest';
import { updateTaskTypeMemory, decayTaskTypeMemory } from '../src/learning/task-memory.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import type { Strategy, AgentConfig } from '../src/core/types.js';
import { MAX_TASK_TYPES } from '../src/core/types.js';

const config: AgentConfig = {
  strategyCount: 16,
 
  mutationRate: 1.0,
  promptStyleDim: 8,
  toolCount: 4,
  noveltyWeight: 0.5,
  elitismRate: 0.1,
  cullThreshold: -2,
  taskBatchSize: 10,
  rescueThreshold: 0.15,
  toolNames: ['a', 'b', 'c', 'd'],
  systemPromptTemplate: 'test',
};

function makeStrategy(): Strategy {
  const genome = createGenome(config);
  return {
    genome,
    fitness: 10,
    age: 5,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(),
  };
}

describe('task-memory', () => {
  beforeEach(() => resetGenomeCounter());

  it('tracks success per type with exponential average', () => {
    const strategy = makeStrategy();
    updateTaskTypeMemory(strategy, 'math', 1.0);
    expect(strategy.taskTypeMemory.get('math')).toBeCloseTo(0.5 * 0.8 + 1.0 * 0.2);

    updateTaskTypeMemory(strategy, 'math', 1.0);
    const expected = (0.5 * 0.8 + 1.0 * 0.2) * 0.8 + 1.0 * 0.2;
    expect(strategy.taskTypeMemory.get('math')).toBeCloseTo(expected);
  });

  it('evicts lowest when exceeding MAX_TASK_TYPES', () => {
    const strategy = makeStrategy();
    for (let i = 0; i <= MAX_TASK_TYPES; i++) {
      updateTaskTypeMemory(strategy, `type_${i}`, i === 0 ? 0.01 : 0.8);
    }
    expect(strategy.taskTypeMemory.size).toBe(MAX_TASK_TYPES);
    expect(strategy.taskTypeMemory.has('type_0')).toBe(false);
  });

  it('decays entries over time', () => {
    const strategy = makeStrategy();
    updateTaskTypeMemory(strategy, 'math', 0.9);
    const before = strategy.taskTypeMemory.get('math')!;

    decayTaskTypeMemory(strategy, 0.97);
    expect(strategy.taskTypeMemory.get('math')!).toBeCloseTo(before * 0.97);
  });

  it('removes entries below 0.05 on decay', () => {
    const strategy = makeStrategy();
    strategy.taskTypeMemory.set('weak', 0.04);
    decayTaskTypeMemory(strategy, 0.97);
    expect(strategy.taskTypeMemory.has('weak')).toBe(false);
  });

  it('initializes missing memory from default', () => {
    const strategy = makeStrategy();
    expect(strategy.taskTypeMemory.size).toBe(0);
    updateTaskTypeMemory(strategy, 'code', 0.7);
    expect(strategy.taskTypeMemory.has('code')).toBe(true);
  });

  it('supports multiple concurrent task types', () => {
    const strategy = makeStrategy();
    updateTaskTypeMemory(strategy, 'math', 0.9);
    updateTaskTypeMemory(strategy, 'code', 0.7);
    updateTaskTypeMemory(strategy, 'writing', 0.5);

    expect(strategy.taskTypeMemory.size).toBe(3);
    expect(strategy.taskTypeMemory.get('math')!).toBeGreaterThan(strategy.taskTypeMemory.get('code')!);
    expect(strategy.taskTypeMemory.get('code')!).toBeGreaterThan(strategy.taskTypeMemory.get('writing')!);
  });
});
