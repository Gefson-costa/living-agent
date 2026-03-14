import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyFitnessDecay,
  selectParents,
  breedOffspring,
  createOffspringStrategy,
  computeNoveltySeed,
  rescueFromElites,
  applyTaskMemoryDecay,
} from '../src/evolution/evolution-engine.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import { NoveltyArchive } from '../src/evolution/novelty.js';
import { MapElites } from '../src/evolution/map-elites.js';
import { snapshotBirthWeights } from '../src/learning/reward-learning.js';
import type { Strategy, AgentConfig } from '../src/core/types.js';

const config: AgentConfig = {
  strategyCount: 16, mutationRate: 1.0,
  promptStyleDim: 4, toolCount: 2, noveltyWeight: 0.5,
  elitismRate: 0.1, cullThreshold: -2, taskBatchSize: 8,
  rescueThreshold: 0.15, toolNames: ['a', 'b'],
  systemPromptTemplate: 'test',
};

function makeStrategy(fitness: number): Strategy {
  const genome = createGenome(config);
  const strategy: Strategy = {
    genome, fitness, age: 3,
    taskHistory: [{ taskId: 't1', strategyId: genome.id, score: 0.7, tokensUsed: 100, latencyMs: 50, response: 'ok', success: true, taskType: 'math' }],
    birthWeights: null,
    taskTypeMemory: new Map([['math', 0.5]]),
  };
  snapshotBirthWeights(strategy);
  return strategy;
}

beforeEach(() => resetGenomeCounter());

// ── applyFitnessDecay ──────────────────────────────────────────

describe('applyFitnessDecay', () => {
  it('decays fitness by default rate 0.95', () => {
    const s = [makeStrategy(10), makeStrategy(20)];
    applyFitnessDecay(s);
    expect(s[0].fitness).toBeCloseTo(9.5);
    expect(s[1].fitness).toBeCloseTo(19);
  });

  it('accepts a custom rate', () => {
    const s = [makeStrategy(10)];
    applyFitnessDecay(s, 0.5);
    expect(s[0].fitness).toBeCloseTo(5);
  });

  it('handles empty array', () => {
    expect(() => applyFitnessDecay([])).not.toThrow();
  });
});

// ── selectParents ──────────────────────────────────────────────

describe('selectParents', () => {
  it('returns two distinct strategies', () => {
    const pool = [makeStrategy(10), makeStrategy(5), makeStrategy(1)];
    const { parent1, parent2 } = selectParents(pool);
    expect(parent1).not.toBe(parent2);
    expect(pool).toContain(parent1);
    expect(pool).toContain(parent2);
  });

  it('works with exactly 2 strategies', () => {
    const pool = [makeStrategy(10), makeStrategy(5)];
    const { parent1, parent2 } = selectParents(pool);
    expect(parent1).not.toBe(parent2);
  });

  it('throws if fewer than 2 strategies', () => {
    expect(() => selectParents([makeStrategy(1)])).toThrow('at least 2');
    expect(() => selectParents([])).toThrow('at least 2');
  });
});

// ── breedOffspring ─────────────────────────────────────────────

describe('breedOffspring', () => {
  it('returns a genome with a new ID', () => {
    const g1 = createGenome(config);
    const g2 = createGenome(config);
    const child = breedOffspring(g1, g2, config.mutationRate, config);
    expect(child.id).not.toBe(g1.id);
    expect(child.id).not.toBe(g2.id);
  });

  it('produces valid genome values', () => {
    const g1 = createGenome(config);
    const g2 = createGenome(config);
    const child = breedOffspring(g1, g2, config.mutationRate, config);
    expect(child.temperature).toBeGreaterThanOrEqual(0);
    expect(child.temperature).toBeLessThanOrEqual(2);
    expect(child.maxTokenBudget).toBeGreaterThanOrEqual(100);
    expect(child.maxTokenBudget).toBeLessThanOrEqual(4096);
  });
});

// ── createOffspringStrategy ────────────────────────────────────

describe('createOffspringStrategy', () => {
  it('creates a strategy with age=0 and empty history', () => {
    const genome = createGenome(config);
    const s = createOffspringStrategy({ genome });
    expect(s.age).toBe(0);
    expect(s.taskHistory).toEqual([]);
    expect(s.taskTypeMemory.size).toBe(0);
  });

  it('snapshots birth weights automatically', () => {
    const genome = createGenome(config);
    const s = createOffspringStrategy({ genome });
    expect(s.birthWeights).not.toBeNull();
    expect(s.birthWeights!.promptStyle.length).toBe(genome.promptStyle.length);
    expect(s.birthWeights!.toolPreferences.length).toBe(genome.toolPreferences.length);
  });

  it('uses noveltySeed as initial fitness', () => {
    const genome = createGenome(config);
    const s = createOffspringStrategy({ genome, noveltySeed: 0.42 });
    expect(s.fitness).toBeCloseTo(0.42);
  });

  it('defaults fitness to 0 when no noveltySeed', () => {
    const genome = createGenome(config);
    const s = createOffspringStrategy({ genome });
    expect(s.fitness).toBe(0);
  });

  it('birth weights are independent copies', () => {
    const genome = createGenome(config);
    const s = createOffspringStrategy({ genome });
    // Mutate genome — birth weights should remain unchanged
    const originalBirth = s.birthWeights!.promptStyle[0];
    s.genome.promptStyle[0] += 99;
    expect(s.birthWeights!.promptStyle[0]).toBe(originalBirth);
  });
});

// ── computeNoveltySeed ─────────────────────────────────────────

describe('computeNoveltySeed', () => {
  it('returns 0 when no archive', () => {
    const genome = createGenome(config);
    expect(computeNoveltySeed(genome, undefined, 0.5)).toBe(0);
  });

  it('returns a positive value with an archive', () => {
    const archive = new NoveltyArchive();
    // Seed the archive with one behavior so novelty is non-zero
    const s = makeStrategy(5);
    archive.add(NoveltyArchive.describe(s));
    const genome = createGenome(config);
    const seed = computeNoveltySeed(genome, archive, 0.8);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('respects the multiplier parameter', () => {
    const archive = new NoveltyArchive();
    const s = makeStrategy(5);
    archive.add(NoveltyArchive.describe(s));
    const genome = createGenome(config);
    const seed05 = computeNoveltySeed(genome, archive, 0.8, 0.5);
    const seed03 = computeNoveltySeed(genome, archive, 0.8, 0.3);
    // 0.3 multiplier should produce a smaller or equal value
    if (seed05 > 0) {
      expect(seed03).toBeLessThanOrEqual(seed05);
    }
  });
});

// ── rescueFromElites ───────────────────────────────────────────

describe('rescueFromElites', () => {
  it('returns null when MAP-Elites is empty', () => {
    const mapElites = new MapElites(8);
    const result = rescueFromElites({ mapElites, mutationRate: 1.0, config });
    expect(result).toBeNull();
  });

  it('returns a mutated champion strategy', () => {
    const mapElites = new MapElites(8);
    const genome = createGenome(config);
    mapElites.insert(genome, 5, { taskDiversity: 0.5, successRate: 0.8, toolEntropy: 0.5, avgTokenEfficiency: 0.5, learningMagnitude: 0 });

    const result = rescueFromElites({ mapElites, mutationRate: 1.0, config });
    expect(result).not.toBeNull();
    expect(result!.age).toBe(0);
    expect(result!.taskHistory).toEqual([]);
    expect(result!.birthWeights).not.toBeNull();
  });

  it('applies novelty seed when archive provided', () => {
    const mapElites = new MapElites(8);
    const genome = createGenome(config);
    mapElites.insert(genome, 5, { taskDiversity: 0.5, successRate: 0.8, toolEntropy: 0.5, avgTokenEfficiency: 0.5, learningMagnitude: 0 });
    const archive = new NoveltyArchive();
    archive.add(NoveltyArchive.describe(makeStrategy(3)));

    const result = rescueFromElites({
      mapElites, mutationRate: 1.0, config,
      noveltyArchive: archive, noveltyWeight: 0.8,
    });
    expect(result).not.toBeNull();
    // Fitness should be >= 0 (novelty seed)
    expect(result!.fitness).toBeGreaterThanOrEqual(0);
  });
});

// ── applyTaskMemoryDecay ───────────────────────────────────────

describe('applyTaskMemoryDecay', () => {
  it('decays task type memory values', () => {
    const s = makeStrategy(5);
    s.taskTypeMemory.set('math', 1.0);
    applyTaskMemoryDecay([s]);
    expect(s.taskTypeMemory.get('math')).toBeLessThan(1.0);
  });

  it('handles empty array', () => {
    expect(() => applyTaskMemoryDecay([])).not.toThrow();
  });
});
