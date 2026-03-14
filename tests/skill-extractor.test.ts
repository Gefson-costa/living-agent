import { describe, it, expect, beforeEach } from 'vitest';
import { SkillExtractor } from '../src/skills/skill-extractor.js';
import { SkillLibrary, resetSkillCounter } from '../src/skills/skill-library.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import type { Task, TaskResult } from '../src/core/types.js';

describe('SkillExtractor', () => {
  let library: SkillLibrary;
  let extractor: SkillExtractor;

  beforeEach(() => {
    resetSkillCounter();
    const store = new MemoryStore();
    library = new SkillLibrary(store);
    extractor = new SkillExtractor(library);
  });

  it('extracts skill from high-scoring task', async () => {
    const task: Task = { id: 't1', type: 'math', prompt: '2+2', difficulty: 0.3 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.9,
      tokensUsed: 50, latencyMs: 100, response: '4',
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
      tokensUsed: 50, latencyMs: 100, response: '5',
      success: false, taskType: 'math',
    };

    const skill = await extractor.tryExtract(task, result);
    expect(skill).toBeNull();
  });

  it('respects custom score threshold', async () => {
    const store = new MemoryStore();
    const lib = new SkillLibrary(store);
    const ext = new SkillExtractor(lib, undefined, { scoreThreshold: 0.95, llmExtraction: false });

    const task: Task = { id: 't1', type: 'math', prompt: '2+2', difficulty: 0.3 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.9,
      tokensUsed: 50, latencyMs: 100, response: '4',
      success: true, taskType: 'math',
    };

    const skill = await ext.tryExtract(task, result);
    expect(skill).toBeNull(); // 0.9 < 0.95 threshold
  });

  it('extracted skill appears in library', async () => {
    const task: Task = { id: 't1', type: 'math', prompt: '2+2', difficulty: 0.3 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.85,
      tokensUsed: 50, latencyMs: 100, response: '4',
      success: true, taskType: 'math',
    };

    await extractor.tryExtract(task, result);
    const skills = await library.getSkillsForTask('math');
    expect(skills.length).toBe(1);
  });

  it('includes task type in extracted content', async () => {
    const task: Task = { id: 't1', type: 'division', prompt: '10/2', difficulty: 0.5 };
    const result: TaskResult = {
      taskId: 't1', strategyId: 's1', score: 0.95,
      tokensUsed: 30, latencyMs: 80, response: '5',
      success: true, taskType: 'division',
    };

    const skill = await extractor.tryExtract(task, result);
    expect(skill!.content).toContain('division');
  });
});
