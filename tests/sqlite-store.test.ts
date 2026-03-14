import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../src/storage/sqlite-store.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import type { AgentConfig, Strategy, Experience, Skill } from '../src/core/types.js';
import { existsSync, unlinkSync } from 'fs';

const DB_PATH = ':memory:';

const config: AgentConfig = {
  strategyCount: 16, mutationRate: 1.0,
  promptStyleDim: 4, toolCount: 2, noveltyWeight: 0.5,
  elitismRate: 0.1, cullThreshold: -2, taskBatchSize: 8,
  rescueThreshold: 0.15, toolNames: ['a', 'b'],
  systemPromptTemplate: 'test',
};

function makeStrategy(): Strategy {
  return {
    genome: createGenome(config),
    fitness: 5,
    age: 3,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map([['math', 0.8]]),
  };
}

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    resetGenomeCounter();
    store = new SqliteStore(DB_PATH);
  });

  afterEach(() => {
    store.close();
  });

  it('saves and loads strategies', async () => {
    const s = makeStrategy();
    await store.saveStrategy(s);
    const loaded = await store.loadStrategies();
    expect(loaded.length).toBe(1);
    expect(loaded[0].genome.id).toBe(s.genome.id);
    expect(loaded[0].fitness).toBe(5);
    expect(loaded[0].taskTypeMemory.get('math')).toBe(0.8);
  });

  it('preserves genome Float32Arrays through serialization', async () => {
    const s = makeStrategy();
    const originalStyle = new Float32Array(s.genome.promptStyle);
    await store.saveStrategy(s);

    const loaded = await store.loadStrategies();
    expect(loaded[0].genome.promptStyle).toBeInstanceOf(Float32Array);
    for (let i = 0; i < originalStyle.length; i++) {
      expect(loaded[0].genome.promptStyle[i]).toBeCloseTo(originalStyle[i], 5);
    }
  });

  it('records and queries experiences', async () => {
    const exp: Experience = {
      strategyId: 'strat_1', taskType: 'math', taskPrompt: '2+2',
      response: '4', score: 1.0, tokensUsed: 10, latencyMs: 50,
    };
    await store.recordExperience(exp);

    const results = await store.queryExperiences({ taskType: 'math' });
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(1.0);
    expect(results[0].strategyId).toBe('strat_1');
  });

  it('filters experiences by strategyId and minScore', async () => {
    await store.recordExperience({ strategyId: 's1', taskType: 'math', taskPrompt: '', response: '', score: 0.8, tokensUsed: 10, latencyMs: 50 });
    await store.recordExperience({ strategyId: 's1', taskType: 'math', taskPrompt: '', response: '', score: 0.3, tokensUsed: 10, latencyMs: 50 });
    await store.recordExperience({ strategyId: 's2', taskType: 'math', taskPrompt: '', response: '', score: 0.9, tokensUsed: 10, latencyMs: 50 });

    const byStrategy = await store.queryExperiences({ strategyId: 's1' });
    expect(byStrategy.length).toBe(2);

    const highScore = await store.queryExperiences({ minScore: 0.5 });
    expect(highScore.length).toBe(2);
  });

  it('limits experience query results', async () => {
    for (let i = 0; i < 10; i++) {
      await store.recordExperience({ strategyId: 's1', taskType: 'math', taskPrompt: '', response: '', score: i * 0.1, tokensUsed: 10, latencyMs: 50 });
    }
    const limited = await store.queryExperiences({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  it('saves and retrieves skills', async () => {
    const skill: Skill = {
      id: 'skill_1', type: 'principle', taskTypes: ['math'],
      content: 'Be precise.', fitness: 0.7, uses: 0, successes: 0,
    };
    await store.saveSkill(skill);

    const skills = await store.getSkills('math');
    expect(skills.length).toBe(1);
    expect(skills[0].content).toBe('Be precise.');
    expect(skills[0].taskTypes).toEqual(['math']);
  });

  it('filters skills by task type', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.5, uses: 0, successes: 0 });
    await store.saveSkill({ id: 's2', type: 'code', taskTypes: ['code'], content: 'b', fitness: 0.5, uses: 0, successes: 0 });

    const mathSkills = await store.getSkills('math');
    expect(mathSkills.length).toBe(1);
  });

  it('updates skill fitness and counters', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.5, uses: 0, successes: 0 });
    await store.updateSkillFitness('s1', 0.1);
    await store.updateSkillFitness('s1', -0.05);

    const skills = await store.getSkills();
    expect(skills[0].fitness).toBeCloseTo(0.55);
    expect(skills[0].uses).toBe(2);
    expect(skills[0].successes).toBe(1); // only positive delta counted
  });

  it('prunes low-fitness skills', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.1, uses: 0, successes: 0 });
    await store.saveSkill({ id: 's2', type: 'code', taskTypes: ['math'], content: 'b', fitness: 0.8, uses: 0, successes: 0 });

    const pruned = await store.pruneSkills(0.5);
    expect(pruned).toBe(1);

    const remaining = await store.getSkills();
    expect(remaining.length).toBe(1);
  });

  it('saves and loads MAP-Elites grid', async () => {
    const genome = createGenome(config);
    await store.saveGrid([{ genome, fitness: 10 }]);

    const loaded = await store.loadGrid();
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(1);
    expect(loaded![0].fitness).toBe(10);
    expect(loaded![0].genome.promptStyle).toBeInstanceOf(Float32Array);
  });

  it('returns null for empty grid', async () => {
    const grid = await store.loadGrid();
    expect(grid).toBeNull();
  });

});
