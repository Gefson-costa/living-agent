import { describe, it, expect, beforeEach } from 'vitest';
import { SkillExtractor } from '../src/skills/skill-extractor.js';
import { SkillLibrary, resetSkillCounter } from '../src/skills/skill-library.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import type { Task, TaskResult } from '../src/core/types.js';

// Realistic response with extractable patterns (steps + reasoning)
const GOOD_RESPONSE = `To solve this problem, I'll break it down step by step.

1. First, identify the equation type
2. Apply the quadratic formula
3. Simplify the discriminant
4. Calculate both roots

Because the discriminant is positive, we get two real solutions.
Therefore x = 3 and x = -1.`;

// Short/conversational response — no extractable skill
const BAD_RESPONSE = '4';

describe('SkillExtractor', () => {
  let library: SkillLibrary;
  let extractor: SkillExtractor;

  beforeEach(() => {
    resetSkillCounter();
    const store = new MemoryStore();
    library = new SkillLibrary(store);
    extractor = new SkillExtractor(library);
  });

  it('extracts skill from high-scoring structured response', async () => {
    const task: Task = { id: 't1', type: 'math', prompt: 'solve x^2-2x-3=0', difficulty: 0.5 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.9,
      tokensUsed: 50, latencyMs: 100, response: GOOD_RESPONSE,
      success: true, taskType: 'math',
    };

    const skill = await extractor.tryExtract(task, result);
    expect(skill).not.toBeNull();
    expect(skill!.taskTypes).toEqual(['math']);
    expect(skill!.fitness).toBe(0.9);
  });

  it('skips low-scoring tasks', async () => {
    const task: Task = { id: 't1', type: 'math', prompt: '2+2', difficulty: 0.3 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.3,
      tokensUsed: 50, latencyMs: 100, response: GOOD_RESPONSE,
      success: false, taskType: 'math',
    };

    const skill = await extractor.tryExtract(task, result);
    expect(skill).toBeNull();
  });

  it('skips short/conversational responses even with high score', async () => {
    const task: Task = { id: 't1', type: 'math', prompt: '2+2', difficulty: 0.3 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.9,
      tokensUsed: 50, latencyMs: 100, response: BAD_RESPONSE,
      success: true, taskType: 'math',
    };

    const skill = await extractor.tryExtract(task, result);
    expect(skill).toBeNull();
  });

  it('respects custom score threshold', async () => {
    const store = new MemoryStore();
    const lib = new SkillLibrary(store);
    const ext = new SkillExtractor(lib, undefined, { scoreThreshold: 0.95, llmExtraction: false });

    const task: Task = { id: 't1', type: 'math', prompt: 'solve x^2-2x-3=0', difficulty: 0.5 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.9,
      tokensUsed: 50, latencyMs: 100, response: GOOD_RESPONSE,
      success: true, taskType: 'math',
    };

    const skill = await ext.tryExtract(task, result);
    expect(skill).toBeNull(); // 0.9 < 0.95 threshold
  });

  it('extracted skill appears in library', async () => {
    const task: Task = { id: 't1', type: 'math', prompt: 'solve x^2-2x-3=0', difficulty: 0.5 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.85,
      tokensUsed: 50, latencyMs: 100, response: GOOD_RESPONSE,
      success: true, taskType: 'math',
    };

    await extractor.tryExtract(task, result);
    const skills = await library.getSkillsForTask('math');
    expect(skills.length).toBe(1);
  });

  it('includes task type in extracted content', async () => {
    const response = `First, understand that division distributes over addition.
1. Split 10 into components
2. Divide each by 2
3. Sum the results
Therefore the answer is 5.`;

    const task: Task = { id: 't1', type: 'division', prompt: '10/2', difficulty: 0.5 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.95,
      tokensUsed: 30, latencyMs: 80, response,
      success: true, taskType: 'division',
    };

    const skill = await extractor.tryExtract(task, result);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('division');
  });

  it('extracts reasoning patterns from response', async () => {
    const task: Task = { id: 't1', type: 'math', prompt: 'solve x^2-2x-3=0', difficulty: 0.5 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.9,
      tokensUsed: 50, latencyMs: 100, response: GOOD_RESPONSE,
      success: true, taskType: 'math',
    };

    const skill = await extractor.tryExtract(task, result);
    expect(skill).not.toBeNull();
    // Should contain step-based approach, not raw response text
    expect(skill!.content).toMatch(/Approach:|Reasoning:/);
  });
});
