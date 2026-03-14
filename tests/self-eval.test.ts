import { describe, it, expect } from 'vitest';
import { selfEvaluate, parseSelfEvalScore, correctSelfEvalBias } from '../src/fitness/self-eval.js';
import { MockAdapter } from '../src/llm/adapter.js';
import type { Task } from '../src/core/types.js';

describe('parseSelfEvalScore', () => {
  it('parses integer score', () => {
    expect(parseSelfEvalScore('7')).toBeCloseTo(0.7, 2);
  });

  it('parses decimal score', () => {
    expect(parseSelfEvalScore('8.5')).toBeCloseTo(0.85, 2);
  });

  it('clamps to 0..1', () => {
    expect(parseSelfEvalScore('15')).toBe(1.0);
    expect(parseSelfEvalScore('0')).toBe(0.0);
  });

  it('returns 0.5 for non-numeric input', () => {
    expect(parseSelfEvalScore('excellent')).toBe(0.5);
    expect(parseSelfEvalScore('')).toBe(0.5);
  });

  it('extracts number from text', () => {
    expect(parseSelfEvalScore('I would rate this a 6 out of 10')).toBeCloseTo(0.6, 2);
  });
});

describe('correctSelfEvalBias', () => {
  it('maps 0.3 to 0', () => {
    expect(correctSelfEvalBias(0.3)).toBeCloseTo(0, 5);
  });

  it('maps 0.9 to 1', () => {
    expect(correctSelfEvalBias(0.9)).toBeCloseTo(1, 5);
  });

  it('maps 0.6 to 0.5 (midpoint)', () => {
    expect(correctSelfEvalBias(0.6)).toBeCloseTo(0.5, 5);
  });

  it('clamps below 0.3 to 0', () => {
    expect(correctSelfEvalBias(0.1)).toBe(0);
    expect(correctSelfEvalBias(0.0)).toBe(0);
  });

  it('clamps above 0.9 to 1', () => {
    expect(correctSelfEvalBias(1.0)).toBeCloseTo(1, 1);
  });

  it('expands the typical LLM range 0.5-0.9 into a wider band', () => {
    const low = correctSelfEvalBias(0.5);
    const mid = correctSelfEvalBias(0.7);
    const high = correctSelfEvalBias(0.9);
    // The spread after correction should be wider
    expect(high - low).toBeGreaterThan(0.9 - 0.5); // > 0.4
    expect(low).toBeCloseTo(0.333, 1);
    expect(mid).toBeCloseTo(0.667, 1);
    expect(high).toBeCloseTo(1.0, 1);
  });
});

describe('selfEvaluate', () => {
  it('returns a score between 0 and 1', async () => {
    const llm = new MockAdapter();
    const task: Task = { id: 't1', type: 'math', prompt: 'Calculate: 2 + 3', difficulty: 0.3 };

    const score = await selfEvaluate(task, '5', llm);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
