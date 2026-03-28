import { describe, it, expect } from 'vitest';
import { buildStrategyPrompt, strategyToLLMConfig } from '../src/llm/prompt-builder.js';
import type { Strategy, StrategyGenome, Skill } from '../src/core/types.js';

function makeGenome(overrides: Partial<StrategyGenome> = {}): StrategyGenome {
  return {
    id: 'test_genome',
    promptStyle: new Float32Array(4),
    toolPreferences: new Float32Array(4),
    temperature: 0.5,
    maxTokenBudget: 1000,
    reasoningDepth: 0.5,
    mutability: 1.0,
    learningRate: 0.01,
    lamarckianRate: 0.02,
    habitatPref: 0.5,
    fewShotCount: 0,
    promptSegments: [],
    skillRefs: [],
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    genome: makeGenome(),
    fitness: 0.5,
    age: 3,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(),
    ...overrides,
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill_1',
    type: 'principle',
    taskTypes: ['math'],
    content: 'Break problems into smaller steps.',
    fitness: 0.8,
    uses: 5,
    successes: 4,
    ...overrides,
  };
}

describe('buildStrategyPrompt', () => {
  const template = 'You are a helpful assistant.';
  const tools = ['search', 'code'];

  it('includes the base template', () => {
    const strategy = makeStrategy();
    const prompt = buildStrategyPrompt(template, strategy, tools);
    expect(prompt).toContain('You are a helpful assistant.');
  });

  it('includes reasoning depth instructions', () => {
    const strategy = makeStrategy({
      genome: makeGenome({ reasoningDepth: 0.9 }),
    });
    const prompt = buildStrategyPrompt(template, strategy, tools);
    expect(prompt).toContain('Think deeply step-by-step');
  });

  it('injects principle skills as "Principle: ..."', () => {
    const strategy = makeStrategy();
    const skills: Skill[] = [
      makeSkill({ type: 'principle', content: 'Always verify your answer.' }),
    ];
    const prompt = buildStrategyPrompt(template, strategy, tools, { skills });
    expect(prompt).toContain('Learned knowledge:');
    expect(prompt).toContain('Principle: Always verify your answer.');
  });

  it('injects code skills as "Skill [types]: ..."', () => {
    const strategy = makeStrategy();
    const skills: Skill[] = [
      makeSkill({ type: 'code', taskTypes: ['math', 'analysis'], content: 'Use modular arithmetic.' }),
    ];
    const prompt = buildStrategyPrompt(template, strategy, tools, { skills });
    expect(prompt).toContain('Skill [math,analysis]: Use modular arithmetic.');
  });

  it('injects multiple skills in order', () => {
    const strategy = makeStrategy();
    const skills: Skill[] = [
      makeSkill({ id: 's1', type: 'principle', content: 'First principle.' }),
      makeSkill({ id: 's2', type: 'code', taskTypes: ['code'], content: 'A pattern.' }),
      makeSkill({ id: 's3', type: 'principle', content: 'Third principle.' }),
    ];
    const prompt = buildStrategyPrompt(template, strategy, tools, { skills });

    const firstIdx = prompt.indexOf('First principle.');
    const secondIdx = prompt.indexOf('A pattern.');
    const thirdIdx = prompt.indexOf('Third principle.');

    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('does not add "Learned knowledge" section when no skills', () => {
    const strategy = makeStrategy();
    const prompt = buildStrategyPrompt(template, strategy, tools, { skills: [] });
    expect(prompt).not.toContain('Learned knowledge');
  });

  it('includes task-type expertise when present', () => {
    const memory = new Map<string, number>([
      ['math', 0.85],
      ['coding', 0.4],  // below 0.6, should not appear
    ]);
    const strategy = makeStrategy({ taskTypeMemory: memory });
    const prompt = buildStrategyPrompt(template, strategy, tools);
    expect(prompt).toContain('Expertise: math (85%)');
    expect(prompt).not.toContain('Expertise: coding');
  });

  it('includes promptStyle traits when values > 0.7', () => {
    const style = new Float32Array([0.8, 0.1, 0.9, 0.2]);  // precise=0.8, creative=0.1, concise=0.9, thorough=0.2
    const strategy = makeStrategy({
      genome: makeGenome({ promptStyle: style }),
    });
    const prompt = buildStrategyPrompt(template, strategy, tools);
    expect(prompt).toContain('Be precise.');    // 0.8 > 0.7
    expect(prompt).toContain('Be concise.');    // 0.9 > 0.7
    expect(prompt).not.toContain('Be creative.');  // 0.1 < 0.7
    expect(prompt).not.toContain('Be thorough.');  // 0.2 < 0.7
  });

  it('includes preferred tools when toolPreferences > 0.6', () => {
    const prefs = new Float32Array([0.9, 0.3, 0.7, 0.1]);
    const strategy = makeStrategy({
      genome: makeGenome({ toolPreferences: prefs }),
    });
    const prompt = buildStrategyPrompt(template, strategy, tools);
    expect(prompt).toContain('Preferred tools: search');
    // Only index 0 and 2 are > 0.6, but tools only has 2 entries
    // so index 2 has no matching tool name
  });
});

describe('strategyToLLMConfig', () => {
  it('builds a complete LLMConfig from strategy', () => {
    const strategy = makeStrategy({
      genome: makeGenome({ temperature: 0.7, maxTokenBudget: 2000 }),
    });
    const config = strategyToLLMConfig(strategy, 'Template.', ['search']);
    expect(config.temperature).toBe(0.7);
    expect(config.maxTokens).toBe(2000);
    expect(config.systemPrompt).toContain('Template.');
    expect(config.toolNames).toEqual(['search']);
  });

  it('includes skills in the system prompt', () => {
    const strategy = makeStrategy();
    const skills = [makeSkill({ content: 'Injected skill.' })];
    const config = strategyToLLMConfig(strategy, 'Base.', [], { skills });
    expect(config.systemPrompt).toContain('Injected skill.');
  });

  it('injects few-shot exemplars into the system prompt', () => {
    const strategy = makeStrategy({
      genome: makeGenome({ maxTokenBudget: 4000 }),
    });
    const exemplars = [
      { taskPrompt: 'What is 2+2?', response: '4', score: 0.9, tokenEstimate: 10 },
      { taskPrompt: 'What is 3*5?', response: '15', score: 0.8, tokenEstimate: 10 },
    ];
    const config = strategyToLLMConfig(strategy, 'Base.', [], { exemplars });
    expect(config.systemPrompt).toContain('Few-shot examples:');
    expect(config.systemPrompt).toContain('Q: What is 2+2?');
    expect(config.systemPrompt).toContain('A: 4');
    expect(config.systemPrompt).toContain('Q: What is 3*5?');
  });

  it('injects evolved prompt segments', () => {
    const strategy = makeStrategy({
      genome: makeGenome({ promptSegments: ['Think step by step.', 'Show your work.'] }),
    });
    const config = strategyToLLMConfig(strategy, 'Base.', []);
    expect(config.systemPrompt).toContain('Think step by step.');
    expect(config.systemPrompt).toContain('Show your work.');
  });

  it('respects token budget for skills and exemplars', () => {
    const strategy = makeStrategy({
      genome: makeGenome({ maxTokenBudget: 200 }), // 20% = 40 tokens budget
    });
    const skills = [
      makeSkill({ content: 'A'.repeat(200) }), // ~50 tokens, exceeds budget
    ];
    const config = strategyToLLMConfig(strategy, 'Base.', [], { skills });
    // Skill exceeds the 40-token budget, so it should be omitted
    expect(config.systemPrompt).not.toContain('Learned knowledge');
  });
});
