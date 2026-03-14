import { describe, it, expect, beforeEach } from 'vitest';
import { NoveltyArchive } from '../src/evolution/novelty.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import type { StrategyBehavior, Strategy, AgentConfig } from '../src/core/types.js';

function makeDesc(overrides: Partial<StrategyBehavior> = {}): StrategyBehavior {
  return {
    successRate: 0.5,
    taskDiversity: 0.5,
    toolEntropy: 0.3,
    avgTokenEfficiency: 0.4,
    learningMagnitude: 0,
    ...overrides,
  };
}

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

describe('NoveltyArchive', () => {
  beforeEach(() => resetGenomeCounter());

  it('returns 1 for novel entries when archive is small', () => {
    const archive = new NoveltyArchive();
    const desc = makeDesc();
    expect(archive.novelty(desc)).toBe(1);
  });

  it('decreases novelty for repeated behaviors', () => {
    const archive = new NoveltyArchive();
    const same = makeDesc({ successRate: 0.5, taskDiversity: 0.3 });

    for (let i = 0; i < 20; i++) archive.add(same);

    const noveltyOfSame = archive.novelty(same);
    const noveltyOfDifferent = archive.novelty(makeDesc({ successRate: 0.9, taskDiversity: 0.9 }));

    expect(noveltyOfSame).toBeLessThan(noveltyOfDifferent);
  });

  it('respects max archive size', () => {
    const archive = new NoveltyArchive();
    for (let i = 0; i < 600; i++) {
      archive.add(makeDesc({ successRate: i / 600 }));
    }
    expect(archive.size).toBe(500);
  });

  it('describe computes from strategy state', () => {
    const genome = createGenome(config);
    const strategy: Strategy = {
      genome,
      fitness: 10,
      age: 5,
      taskHistory: [
        { taskId: 'a', strategyId: genome.id, score: 0.8, tokensUsed: 100, latencyMs: 50, response: '42', success: true, taskType: 'math' },
        { taskId: 'b', strategyId: genome.id, score: 0.3, tokensUsed: 200, latencyMs: 100, response: '?', success: false, taskType: 'code' },
        { taskId: 'c', strategyId: genome.id, score: 0.9, tokensUsed: 50, latencyMs: 30, response: '7', success: true, taskType: 'math' },
      ],
      birthWeights: null,
      taskTypeMemory: new Map(),
    };

    const desc = NoveltyArchive.describe(strategy);
    expect(desc.successRate).toBeCloseTo(2 / 3, 2);
    expect(desc.taskDiversity).toBeGreaterThan(0);
    expect(desc.toolEntropy).toBeGreaterThanOrEqual(0);
    expect(desc.avgTokenEfficiency).toBeGreaterThan(0);
  });

  it('describe handles empty history', () => {
    const genome = createGenome(config);
    const strategy: Strategy = {
      genome,
      fitness: 5,
      age: 0,
      taskHistory: [],
      birthWeights: null,
      taskTypeMemory: new Map(),
    };

    const desc = NoveltyArchive.describe(strategy);
    expect(desc.successRate).toBe(0);
    expect(desc.taskDiversity).toBe(0);
    expect(desc.avgTokenEfficiency).toBe(0);
  });

  it('describe includes learning magnitude when birth weights exist', () => {
    const genome = createGenome(config);
    const strategy: Strategy = {
      genome,
      fitness: 10,
      age: 5,
      taskHistory: [
        { taskId: 'a', strategyId: genome.id, score: 0.8, tokensUsed: 100, latencyMs: 50, response: '42', success: true, taskType: 'math' },
      ],
      birthWeights: {
        promptStyle: new Float32Array(genome.promptStyle.length),
        toolPreferences: new Float32Array(genome.toolPreferences.length),
      },
      taskTypeMemory: new Map(),
    };

    // Push style away from birth
    for (let i = 0; i < genome.promptStyle.length; i++) {
      genome.promptStyle[i] = 0.5;
    }

    const desc = NoveltyArchive.describe(strategy);
    expect(desc.learningMagnitude).toBeGreaterThan(0);
  });
});
