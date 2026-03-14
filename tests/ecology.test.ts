import { describe, it, expect, beforeEach } from 'vitest';
import { Ecology } from '../src/evolution/ecology.js';
import { MockAdapter } from '../src/llm/adapter.js';
import { MathEvaluator } from '../src/fitness/evaluator.js';
import { resetGenomeCounter } from '../src/evolution/genome.js';
import type { AgentConfig, EcologyStats } from '../src/core/types.js';

const config: AgentConfig = {
  strategyCount: 12,
 
  mutationRate: 1.0,
  promptStyleDim: 4,
  toolCount: 2,
  noveltyWeight: 0.5,
  elitismRate: 0.1,
  cullThreshold: -5,
  taskBatchSize: 8,
  rescueThreshold: 0.15,
  toolNames: ['calc', 'verify'],
  systemPromptTemplate: 'Solve math.',
};

describe('Ecology', () => {
  beforeEach(() => resetGenomeCounter());

  it('initializes with correct strategy count', () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    const stats = ecology.getStats();

    expect(stats.strategyCount).toBe(12);
    expect(stats.cycle).toBe(0);
  });

  it('runs a single cycle', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    const stats = await ecology.runCycle();

    expect(stats.cycle).toBe(1);
    expect(stats.strategyCount).toBeGreaterThan(0);
  });

  it('runs multiple cycles without crashing', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    const allStats = await ecology.run(10);

    expect(allStats.length).toBe(10);
    expect(allStats[9].cycle).toBe(10);
    expect(allStats[9].strategyCount).toBeGreaterThan(0);
  });

  it('getBestStrategy returns the highest fitness strategy', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(5);

    const best = ecology.getBestStrategy();
    expect(best).not.toBeNull();

    const strategies = ecology.getStrategies();
    for (const s of strategies) {
      expect(best!.fitness).toBeGreaterThanOrEqual(s.fitness);
    }
  });

  it('killFraction removes strategies', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(5);

    const prePop = ecology.getStats().strategyCount;
    const killed = ecology.killFraction(0.5);

    expect(killed).toBeGreaterThan(0);
    expect(ecology.getStats().strategyCount).toBeLessThan(prePop);
    expect(ecology.getStats().strategyCount).toBe(prePop - killed);
  });

  it('triggers rescue after population crash', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(10);

    ecology.killFraction(0.9);
    const postKill = ecology.getStats().strategyCount;

    await ecology.run(10);
    const recovered = ecology.getStats().strategyCount;

    expect(recovered).toBeGreaterThan(postKill);
  });

  it('callbacks fire correctly', async () => {
    let cycleStarts = 0;
    let cycleEnds = 0;
    let births = 0;

    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator(), {
      onCycleStart: () => cycleStarts++,
      onCycleEnd: () => cycleEnds++,
      onBirth: () => births++,
    });

    // Initial spawn triggers births
    expect(births).toBe(config.strategyCount);

    await ecology.run(3);
    expect(cycleStarts).toBe(3);
    expect(cycleEnds).toBe(3);
  });

  it('strategies accumulate task history', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(3);

    const strategies = ecology.getStrategies();
    const withHistory = strategies.filter(s => s.taskHistory.length > 0);
    expect(withHistory.length).toBeGreaterThan(0);
  });

  it('strategies age over cycles', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(5);

    const strategies = ecology.getStrategies();
    const maxAge = Math.max(...strategies.map(s => s.age));
    expect(maxAge).toBeGreaterThan(0);
  });

  it('MAP-Elites coverage is positive after cycles', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(10);
    const stats = ecology.getStats();

    // CycleQD clears grid each cycle, but within a cycle elites are inserted
    expect(stats.mapElitesCoverage).toBeGreaterThan(0);
    expect(stats.mapElitesAxes).toBeDefined();
    expect(stats.mapElitesAxes!.length).toBe(2);
  });

  it('novelty archive grows over time', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(10);
    const stats = ecology.getStats();

    expect(stats.noveltyArchiveSize).toBeGreaterThan(0);
  });

  it('births and deaths are tracked', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(10);
    const stats = ecology.getStats();

    expect(stats.births).toBeGreaterThan(config.strategyCount);
  });

  it('task-type memory is maintained per strategy', async () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    await ecology.run(5);

    const strategies = ecology.getStrategies();
    const withMemory = strategies.filter(s => s.taskTypeMemory.size > 0);
    expect(withMemory.length).toBeGreaterThan(0);
  });

  it('onTaskComplete callback fires for each task', async () => {
    let taskCompletes = 0;
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator(), {
      onTaskComplete: () => taskCompletes++,
    });
    await ecology.runCycle();

    expect(taskCompletes).toBeGreaterThan(0);
    expect(taskCompletes).toBeLessThanOrEqual(config.strategyCount);
  });

  it('strategies have birth weights after initialization', () => {
    const ecology = new Ecology(config, new MockAdapter(), new MathEvaluator());
    const strategies = ecology.getStrategies();

    for (const s of strategies) {
      expect(s.birthWeights).not.toBeNull();
      expect(s.birthWeights!.promptStyle.length).toBe(config.promptStyleDim);
      expect(s.birthWeights!.toolPreferences.length).toBe(config.toolCount);
    }
  });
});
