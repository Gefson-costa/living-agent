import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../src/storage/memory-store.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import type { AgentConfig, Strategy, Experience, Skill } from '../src/core/types.js';

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

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    resetGenomeCounter();
    store = new MemoryStore();
  });

  it('saves and loads strategies', async () => {
    const s = makeStrategy();
    await store.saveStrategy(s);
    const loaded = await store.loadStrategies();
    expect(loaded.length).toBe(1);
    expect(loaded[0].genome.id).toBe(s.genome.id);
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
  });

  it('filters experiences by strategyId', async () => {
    await store.recordExperience({ strategyId: 's1', taskType: 'math', taskPrompt: '', response: '', score: 0.8, tokensUsed: 10, latencyMs: 50 });
    await store.recordExperience({ strategyId: 's2', taskType: 'math', taskPrompt: '', response: '', score: 0.6, tokensUsed: 10, latencyMs: 50 });

    const results = await store.queryExperiences({ strategyId: 's1' });
    expect(results.length).toBe(1);
  });

  it('filters experiences by minScore', async () => {
    await store.recordExperience({ strategyId: 's1', taskType: 'math', taskPrompt: '', response: '', score: 0.8, tokensUsed: 10, latencyMs: 50 });
    await store.recordExperience({ strategyId: 's1', taskType: 'math', taskPrompt: '', response: '', score: 0.3, tokensUsed: 10, latencyMs: 50 });

    const results = await store.queryExperiences({ minScore: 0.5 });
    expect(results.length).toBe(1);
    expect(results[0].score).toBe(0.8);
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
  });

  it('filters skills by task type', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.5, uses: 0, successes: 0 });
    await store.saveSkill({ id: 's2', type: 'code', taskTypes: ['code'], content: 'b', fitness: 0.5, uses: 0, successes: 0 });

    const mathSkills = await store.getSkills('math');
    expect(mathSkills.length).toBe(1);

    const allSkills = await store.getSkills();
    expect(allSkills.length).toBe(2);
  });

  it('updates skill fitness', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.5, uses: 0, successes: 0 });
    await store.updateSkillFitness('s1', 0.1);

    const skills = await store.getSkills();
    expect(skills[0].fitness).toBeCloseTo(0.6);
    expect(skills[0].uses).toBe(1);
    expect(skills[0].successes).toBe(1);
  });

  it('prunes low-fitness skills', async () => {
    await store.saveSkill({ id: 's1', type: 'principle', taskTypes: ['math'], content: 'a', fitness: 0.1, uses: 0, successes: 0 });
    await store.saveSkill({ id: 's2', type: 'code', taskTypes: ['math'], content: 'b', fitness: 0.8, uses: 0, successes: 0 });

    const pruned = await store.pruneSkills(0.5);
    expect(pruned).toBe(1);

    const remaining = await store.getSkills();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('s2');
  });

  it('saves and loads grid', async () => {
    const genome = createGenome(config);
    await store.saveGrid([{ genome, fitness: 10 }]);

    const loaded = await store.loadGrid();
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(1);
    expect(loaded![0].fitness).toBe(10);
  });

});
