import { describe, it, expect, beforeEach } from 'vitest';
import { selectStrategy, scoreStrategy } from '../src/agent/strategy-selector.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import { snapshotBirthWeights } from '../src/learning/reward-learning.js';
import { NoveltyArchive } from '../src/evolution/novelty.js';
import { hashString } from '../src/core/utils.js';
import type { Strategy, AgentConfig } from '../src/core/types.js';

const agentConfig: AgentConfig = {
  strategyCount: 8,
 
  mutationRate: 1.0,
  promptStyleDim: 4,
  toolCount: 2,
  noveltyWeight: 0.5,
  elitismRate: 0.1,
  cullThreshold: -5,
  taskBatchSize: 8,
  rescueThreshold: 0.15,
  toolNames: ['search', 'code'],
  systemPromptTemplate: 'Solve tasks.',
};

function makeStrategy(fitness: number, taskTypeScores?: Record<string, number>): Strategy {
  const genome = createGenome(agentConfig);
  const strategy: Strategy = {
    genome,
    fitness,
    age: 0,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(Object.entries(taskTypeScores ?? {})),
  };
  snapshotBirthWeights(strategy);
  return strategy;
}

describe('scoreStrategy', () => {
  beforeEach(() => resetGenomeCounter());

  it('returns higher score for strategies with task expertise', () => {
    const expert = makeStrategy(0.5, { coding: 0.9 });
    const novice = makeStrategy(0.5, { coding: 0.2 });

    const expertScore = scoreStrategy(expert, 'coding');
    const noviceScore = scoreStrategy(novice, 'coding');

    expect(expertScore).toBeGreaterThan(noviceScore);
  });

  it('returns higher score for strategies with better fitness', () => {
    const fit = makeStrategy(0.9);
    const unfit = makeStrategy(0.1);

    expect(scoreStrategy(fit, 'general')).toBeGreaterThan(scoreStrategy(unfit, 'general'));
  });

  it('defaults to 0.5 expertise for unknown task types', () => {
    const strategy = makeStrategy(0.5);
    const score = scoreStrategy(strategy, 'research');
    // Should use 0.5 default expertise
    expect(score).toBeGreaterThan(0);
  });

  it('returns a value between 0 and 1', () => {
    const strategy = makeStrategy(0.7, { analysis: 0.8 });
    const score = scoreStrategy(strategy, 'analysis');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('selectStrategy', () => {
  beforeEach(() => resetGenomeCounter());

  it('throws on empty strategy pool', () => {
    expect(() => selectStrategy([], 'general')).toThrow('Cannot select from empty strategy pool');
  });

  it('returns the only strategy when pool has one', () => {
    const s = makeStrategy(0.5);
    expect(selectStrategy([s], 'general')).toBe(s);
  });

  it('tends to select the best strategy with epsilon=0', () => {
    const strategies = [
      makeStrategy(0.1),
      makeStrategy(0.9, { coding: 0.95 }),
      makeStrategy(0.3),
    ];

    // With epsilon=0, should always pick the best
    const counts = new Map<string, number>();
    for (let i = 0; i < 50; i++) {
      const selected = selectStrategy(strategies, 'coding', { epsilon: 0 });
      const id = selected.genome.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    // The best strategy (index 1) should be selected every time
    expect(counts.get(strategies[1].genome.id)).toBe(50);
  });

  it('explores sometimes with epsilon=1', () => {
    const strategies = [
      makeStrategy(0.1),
      makeStrategy(0.9),
      makeStrategy(0.5),
    ];

    const selected = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const s = selectStrategy(strategies, 'general', { epsilon: 1 });
      selected.add(s.genome.id);
    }

    // With full exploration, we should see multiple strategies selected
    expect(selected.size).toBeGreaterThan(1);
  });

  it('strategy with habitatPref near task hash scores higher', () => {
    // Compute the task hash for 'coding'
    const codingHash = hashString('coding') / 0xFFFFFFFF;

    const nearHabitat = makeStrategy(0.5);
    nearHabitat.genome.habitatPref = codingHash; // perfect match

    const farHabitat = makeStrategy(0.5);
    farHabitat.genome.habitatPref = (codingHash + 0.5) % 1; // far from match

    const nearScore = scoreStrategy(nearHabitat, 'coding');
    const farScore = scoreStrategy(farHabitat, 'coding');

    expect(nearScore).toBeGreaterThan(farScore);
  });

  it('prefers task experts over generally fit strategies', () => {
    const generalist = makeStrategy(0.8, { general: 0.8 });
    const specialist = makeStrategy(0.5, { coding: 0.95 });
    // Control habitatPref so it doesn't interfere with the expertise comparison
    generalist.genome.habitatPref = 0.5;
    specialist.genome.habitatPref = 0.5;

    // With no exploration, specialist should win for coding tasks
    const counts = new Map<string, number>();
    for (let i = 0; i < 50; i++) {
      const s = selectStrategy([generalist, specialist], 'coding', { epsilon: 0 });
      counts.set(s.genome.id, (counts.get(s.genome.id) ?? 0) + 1);
    }

    expect(counts.get(specialist.genome.id)).toBe(50);
  });

  it('novelty archive changes selection when scores are close', () => {
    const archive = new NoveltyArchive();

    // Two strategies with identical fitness, expertise, and habitatPref
    const a = makeStrategy(0.5, { coding: 0.6 });
    const b = makeStrategy(0.5, { coding: 0.6 });
    // Control all genome variables so only novelty differs
    a.genome.habitatPref = 0.5;
    b.genome.habitatPref = 0.5;
    a.genome.temperature = 0.5;
    b.genome.temperature = 0.5;

    // Add a's behavior to the archive repeatedly — making a less novel
    const descA = NoveltyArchive.describe(a);
    for (let i = 0; i < 10; i++) archive.add(descA);

    // Score with vs without novelty archive
    const scoreWithout = scoreStrategy(a, 'coding');
    const scoreWith = scoreStrategy(a, 'coding', undefined, { noveltyArchive: archive });

    // Novelty weight should add a bonus to the score
    // Both a and b have the same base score, but novelty differs
    expect(scoreWith).not.toBe(scoreWithout);
  });
});
