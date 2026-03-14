import { describe, it, expect } from 'vitest';
import { extractAnswer, Gsm8kEvaluator } from '../benchmarks/evaluators/gsm8k-evaluator.js';

describe('extractAnswer', () => {
  it('extracts last integer from simple response', () => {
    expect(extractAnswer('The answer is 42')).toBe(42);
  });

  it('extracts last number when multiple numbers present', () => {
    expect(extractAnswer('First we get 10, then add 5, so the answer is 15')).toBe(15);
  });

  it('strips commas from large numbers', () => {
    expect(extractAnswer('The total is 1,234')).toBe(1234);
  });

  it('rounds decimal to nearest integer', () => {
    expect(extractAnswer('The answer is 42.7')).toBe(43);
    expect(extractAnswer('The answer is 42.3')).toBe(42);
  });

  it('handles negative numbers', () => {
    expect(extractAnswer('The result is -5')).toBe(-5);
  });

  it('returns null for no numbers', () => {
    expect(extractAnswer('I cannot solve this problem')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractAnswer('')).toBeNull();
  });

  it('handles step-by-step reasoning with final answer', () => {
    const response = `Step 1: Start with 48 clips in April.
Step 2: Half of 48 is 24 clips in May.
Step 3: 48 + 24 = 72 total clips.
The answer is 72.`;
    expect(extractAnswer(response)).toBe(72);
  });

  it('handles large comma-separated numbers', () => {
    expect(extractAnswer('She earns $1,000,000 per year')).toBe(1000000);
  });
});

describe('Gsm8kEvaluator', () => {
  it('loads train split', () => {
    const evaluator = new Gsm8kEvaluator('train');
    const items = evaluator.getAllItems();
    expect(items.length).toBe(200);
    expect(items[0].id).toBe('gsm8k_train_0');
    expect(items[0].answer).toBe('72');
  });

  it('loads eval split', () => {
    const evaluator = new Gsm8kEvaluator('eval');
    const items = evaluator.getAllItems();
    expect(items.length).toBe(200);
    expect(items[0].id).toBe('gsm8k_eval_0');
  });

  it('generateTasks returns tasks with prompts', () => {
    const evaluator = new Gsm8kEvaluator('train');
    const tasks = evaluator.generateTasks(5);
    expect(tasks.length).toBe(5);
    expect(tasks[0].type).toBe('gsm8k');
    expect(tasks[0].prompt).toContain('Natalia');
  });

  it('score returns fuzzy value for close answers', () => {
    const evaluator = new Gsm8kEvaluator('train');
    const tasks = evaluator.generateTasks(1);
    // Gold answer for train_0 is 72
    expect(evaluator.score(tasks[0], 'The answer is 72')).toBe(1.0);
    expect(evaluator.score(tasks[0], 'The answer is 73')).toBeGreaterThan(0);
    expect(evaluator.score(tasks[0], 'The answer is 73')).toBeLessThan(1);
    expect(evaluator.score(tasks[0], 'The answer is 999')).toBe(0);
  });

  it('scoreById returns binary 0/1', () => {
    const evaluator = new Gsm8kEvaluator('train');
    expect(evaluator.scoreById('gsm8k_train_0', 'The answer is 72')).toBe(1);
    expect(evaluator.scoreById('gsm8k_train_0', 'The answer is 73')).toBe(0);
    expect(evaluator.scoreById('gsm8k_train_0', 'The answer is 71')).toBe(0);
  });

  it('generateTasks cycles through items', () => {
    const evaluator = new Gsm8kEvaluator('train');
    const batch1 = evaluator.generateTasks(3);
    const batch2 = evaluator.generateTasks(3);
    expect(batch1[0].id).toBe('gsm8k_train_0');
    expect(batch2[0].id).toBe('gsm8k_train_3');
  });
});
