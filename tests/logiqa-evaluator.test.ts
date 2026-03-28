import { describe, it, expect } from 'vitest';
import { extractAnswer } from '../benchmarks/evaluators/logiqa-evaluator.js';

describe('LogiQA extractAnswer', () => {
  it('extracts "The answer is X" pattern', () => {
    expect(extractAnswer('After analyzing all options, the answer is B')).toBe(1);
    expect(extractAnswer('The answer is A.')).toBe(0);
    expect(extractAnswer('The answer is D')).toBe(3);
  });

  it('extracts "Answer: X" pattern', () => {
    expect(extractAnswer('Answer: C')).toBe(2);
    expect(extractAnswer('My answer: A')).toBe(0);
  });

  it('extracts last standalone letter', () => {
    expect(extractAnswer('I think option B is correct because... so B')).toBe(1);
    expect(extractAnswer('Looking at A and C, I choose C')).toBe(2);
  });

  it('returns null for no valid answer', () => {
    expect(extractAnswer('I am not sure about this question')).toBe(null);
    expect(extractAnswer('42')).toBe(null);
    expect(extractAnswer('')).toBe(null);
  });

  it('handles case insensitivity', () => {
    expect(extractAnswer('the answer is b')).toBe(1);
    expect(extractAnswer('THE ANSWER IS C')).toBe(2);
  });

  it('ignores letters E and beyond', () => {
    // "E" should not match as a valid answer
    expect(extractAnswer('The answer is E')).toBe(null);
  });

  it('handles CoT-style responses ending with answer', () => {
    const response = `Let me analyze this step by step.

First, the context says all Cantonese are southerners.
Option A talks about liking chili - irrelevant.
Option B mentions people who like peppers - doesn't help.
Option C says all Cantonese are southerners - this guarantees the argument.
Option D is about peppers and sweets - irrelevant.

The answer is C`;
    expect(extractAnswer(response)).toBe(2);
  });

  it('extracts "choose/select X" patterns', () => {
    expect(extractAnswer('I would choose B based on the analysis')).toBe(1);
    expect(extractAnswer('We should select D')).toBe(3);
  });

  it('extracts "X is correct" patterns', () => {
    expect(extractAnswer('After analysis, A is the correct answer')).toBe(0);
    expect(extractAnswer('C is correct because...')).toBe(2);
  });

  it('extracts bolded answers **X**', () => {
    expect(extractAnswer('The best choice is **B**')).toBe(1);
    expect(extractAnswer('So we get **D**.')).toBe(3);
  });

  it('handles truncated responses by finding last letter', () => {
    // Truncated reasoning that mentions options but never concludes
    const truncated = 'Looking at option A and B, if we consider B then the constraint on C means that position 3';
    expect(extractAnswer(truncated)).toBe(2); // last standalone letter is C
  });
});
