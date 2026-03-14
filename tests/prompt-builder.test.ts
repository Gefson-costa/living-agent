import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/llm/adapter.js';
import type { StrategyGenome } from '../src/core/types.js';

function makeGenome(overrides: Partial<StrategyGenome> = {}): StrategyGenome {
  return {
    id: 'test',
    promptStyle: new Float32Array(4),
    toolPreferences: new Float32Array(4),
    temperature: 0.5,
    maxTokenBudget: 1000,
    reasoningDepth: 0.5,
    mutability: 1.0,
    learningRate: 0.01,
    lamarckianRate: 0.02,
    habitatPref: 0.5,
    skillRefs: [],
    ...overrides,
  };
}

describe('buildSystemPrompt reasoning depth', () => {
  const template = 'You are a helpful assistant.';
  const tools = ['search', 'code'];

  it('depth > 0.8 → deep step-by-step with multiple approaches', () => {
    const g = makeGenome({ reasoningDepth: 0.9 });
    const prompt = buildSystemPrompt(template, g, tools);
    expect(prompt).toContain('Think deeply step-by-step, consider multiple approaches');
  });

  it('depth 0.6–0.8 → step-by-step with reasoning', () => {
    const g = makeGenome({ reasoningDepth: 0.7 });
    const prompt = buildSystemPrompt(template, g, tools);
    expect(prompt).toContain('Think step-by-step, show your reasoning');
  });

  it('depth 0.4–0.6 → brief reasoning outline', () => {
    const g = makeGenome({ reasoningDepth: 0.5 });
    const prompt = buildSystemPrompt(template, g, tools);
    expect(prompt).toContain('Briefly outline your reasoning, then answer');
  });

  it('depth 0.2–0.4 → concise minimal explanation', () => {
    const g = makeGenome({ reasoningDepth: 0.3 });
    const prompt = buildSystemPrompt(template, g, tools);
    expect(prompt).toContain('Be concise, minimal explanation');
  });

  it('depth ≤ 0.2 → direct immediate answer', () => {
    const g = makeGenome({ reasoningDepth: 0.1 });
    const prompt = buildSystemPrompt(template, g, tools);
    expect(prompt).toContain('Be direct, answer immediately');
  });

  it('all 5 levels produce distinct prompts', () => {
    const depths = [0.9, 0.7, 0.5, 0.3, 0.1];
    const prompts = depths.map(d => {
      const g = makeGenome({ reasoningDepth: d });
      return buildSystemPrompt(template, g, tools);
    });
    const unique = new Set(prompts);
    expect(unique.size).toBe(5);
  });
});
