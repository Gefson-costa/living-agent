import { describe, it, expect } from 'vitest';
import {
  computeLocalEval,
  shouldCallLLMEval,
  DEFAULT_LLM_BUDGET,
} from '../src/fitness/local-eval.js';
import type { LocalEvalResult, LLMBudget } from '../src/fitness/local-eval.js';
import type { Task } from '../src/core/types.js';

function makeTask(type = 'general', prompt = 'Explain how sorting works'): Task {
  return { id: 't1', type, prompt, difficulty: 0.5 };
}

// ── computeLocalEval ────────────────────────────────────────────

describe('computeLocalEval', () => {
  it('scores empty response as 0 with high confidence', () => {
    const result = computeLocalEval('', makeTask());
    expect(result.score).toBe(0);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.method).toBe('local');
  });

  it('scores error response as 0', () => {
    const result = computeLocalEval('Error: something broke', makeTask());
    expect(result.score).toBe(0);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('scores a reasonable general response positively', () => {
    const response = 'Sorting algorithms arrange elements in a specific order. Common ones include quicksort, mergesort, and bubble sort. Quicksort uses a divide and conquer approach with a pivot element.';
    const result = computeLocalEval(response, makeTask());
    expect(result.score).toBeGreaterThan(0.4);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('scores coding response with code block higher for coding tasks', () => {
    const withCode = 'Here is the solution:\n```python\ndef sort(arr):\n  return sorted(arr)\n```';
    const withoutCode = 'You can use the built-in sort function to sort the array in place.';

    const task = makeTask('coding', 'Write a sort function');
    const scoreWith = computeLocalEval(withCode, task);
    const scoreWithout = computeLocalEval(withoutCode, task);
    expect(scoreWith.score).toBeGreaterThan(scoreWithout.score);
  });

  it('returns confidence between 0 and 1', () => {
    const result = computeLocalEval('A short answer.', makeTask());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('gives higher keyword overlap score when response is relevant', () => {
    const task = makeTask('research', 'What are the benefits of renewable energy sources?');
    const relevant = 'Renewable energy sources like solar and wind provide clean benefits including reduced emissions and sustainable power generation.';
    const irrelevant = 'The cat sat on the mat and looked at the window.';

    const relevantResult = computeLocalEval(relevant, task);
    const irrelevantResult = computeLocalEval(irrelevant, task);
    expect(relevantResult.score).toBeGreaterThan(irrelevantResult.score);
  });
});

// ── shouldCallLLMEval ──────────────────────────────────────────

describe('shouldCallLLMEval', () => {
  it('always calls LLM for new genomes', () => {
    const localResult: LocalEvalResult = { score: 0.8, confidence: 0.9, method: 'local' };
    expect(shouldCallLLMEval(localResult, 0)).toBe(true);
    expect(shouldCallLLMEval(localResult, 4)).toBe(true);
  });

  it('does not require LLM for mature genome with high confidence and high score', () => {
    const localResult: LocalEvalResult = { score: 0.85, confidence: 0.95, method: 'local' };
    // After the budget sampling, most high-confidence cases should skip LLM
    // At least some should return false
    const results = Array.from({ length: 20 }, (_, i) =>
      shouldCallLLMEval(localResult, 10 + i),
    );
    expect(results.some(r => !r)).toBe(true);
  });

  it('calls LLM for low local score', () => {
    const localResult: LocalEvalResult = { score: 0.2, confidence: 0.8, method: 'local' };
    expect(shouldCallLLMEval(localResult, 10)).toBe(true);
  });

  it('calls LLM for low confidence', () => {
    const localResult: LocalEvalResult = { score: 0.7, confidence: 0.3, method: 'local' };
    expect(shouldCallLLMEval(localResult, 10)).toBe(true);
  });

  it('calls LLM in uncertainty zone', () => {
    const localResult: LocalEvalResult = { score: 0.5, confidence: 0.8, method: 'local' };
    expect(shouldCallLLMEval(localResult, 10)).toBe(true);
  });

  it('respects custom budget', () => {
    const budget: LLMBudget = {
      selfEvalRate: 0,  // never sample
      forceLLMEvalThreshold: 0.1,
      newGenomeInteractions: 2,
    };
    const localResult: LocalEvalResult = { score: 0.85, confidence: 0.95, method: 'local' };
    // Mature genome, high score, high confidence, zero budget → should not call LLM
    expect(shouldCallLLMEval(localResult, 10, budget)).toBe(false);
  });
});

// ── DEFAULT_LLM_BUDGET ─────────────────────────────────────────

describe('DEFAULT_LLM_BUDGET', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_LLM_BUDGET.selfEvalRate).toBe(0.3);
    expect(DEFAULT_LLM_BUDGET.forceLLMEvalThreshold).toBe(0.35);
    expect(DEFAULT_LLM_BUDGET.newGenomeInteractions).toBe(5);
  });
});
