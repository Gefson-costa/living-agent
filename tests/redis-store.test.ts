import { describe, it, expect, beforeEach } from 'vitest';
import { RedisStore } from '../src/storage/redis-store.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import type { AgentConfig, Experience, Skill } from '../src/core/types.js';

const config: AgentConfig = {
  strategyCount: 16, mutationRate: 1.0,
  promptStyleDim: 4, toolCount: 2, noveltyWeight: 0.5,
  elitismRate: 0.1, cullThreshold: -2, taskBatchSize: 8,
  rescueThreshold: 0.15, toolNames: ['a', 'b'],
  systemPromptTemplate: 'test',
};

describe('RedisStore (fallback mode)', () => {
  let store: RedisStore;

  beforeEach(() => {
    resetGenomeCounter();
    // No Redis URL → uses in-memory fallback
    store = new RedisStore();
  });

  it('saves and loads strategies via fallback', async () => {
    const genome = createGenome(config);
    await store.saveStrategy({
      genome, fitness: 5, age: 3,
      taskHistory: [], birthWeights: null,
      taskTypeMemory: new Map([['math', 0.8]]),
    });

    const loaded = await store.loadStrategies();
    expect(loaded.length).toBe(1);
    expect(loaded[0].genome.id).toBe(genome.id);
  });

  it('records and queries experiences via fallback', async () => {
    const exp: Experience = {
      strategyId: 'strat_1', taskType: 'math', taskPrompt: '2+2',
      response: '4', score: 1.0, tokensUsed: 10, latencyMs: 50,
    };
    await store.recordExperience(exp);

    const results = await store.queryExperiences({ taskType: 'math' });
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(1.0);
  });

  it('saves and retrieves skills via fallback', async () => {
    const skill: Skill = {
      id: 'skill_1', type: 'principle', taskTypes: ['math'],
      content: 'Be precise.', fitness: 0.7, uses: 0, successes: 0,
    };
    await store.saveSkill(skill);

    const skills = await store.getSkills('math');
    expect(skills.length).toBe(1);
    expect(skills[0].content).toBe('Be precise.');
  });

  it('updates skill fitness via fallback', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.5, uses: 0, successes: 0 });
    await store.updateSkillFitness('s1', 0.1);

    const skills = await store.getSkills();
    expect(skills[0].fitness).toBeCloseTo(0.6);
  });

  it('prunes skills via fallback', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.1, uses: 0, successes: 0 });
    await store.saveSkill({ id: 's2', type: 'code', taskTypes: ['math'], content: 'b', fitness: 0.8, uses: 0, successes: 0 });

    const pruned = await store.pruneSkills(0.5);
    expect(pruned).toBe(1);
  });

  it('saves and loads grid via fallback', async () => {
    const genome = createGenome(config);
    await store.saveGrid([{ genome, fitness: 10 }]);

    const loaded = await store.loadGrid();
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(1);
  });

  it('returns null for empty grid via fallback', async () => {
    const grid = await store.loadGrid();
    expect(grid).toBeNull();
  });

  it('close does not throw without Redis connection', async () => {
    await expect(store.close()).resolves.not.toThrow();
  });
});
