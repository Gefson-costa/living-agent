import { describe, it, expect } from 'vitest';
import { extractBoxed, normalizeLatex, Math500Evaluator } from '../benchmarks/evaluators/math500-evaluator.js';

describe('extractBoxed', () => {
  it('extracts simple integer', () => {
    expect(extractBoxed('The answer is \\boxed{42}')).toBe('42');
  });

  it('extracts fraction with nested braces', () => {
    expect(extractBoxed('So \\boxed{\\frac{14}{3}}')).toBe('\\frac{14}{3}');
  });

  it('extracts sqrt', () => {
    expect(extractBoxed('The value is \\boxed{\\sqrt{51}}')).toBe('\\sqrt{51}');
  });

  it('extracts deeply nested braces', () => {
    expect(extractBoxed('\\boxed{\\frac{\\sqrt{2}}{3}}')).toBe('\\frac{\\sqrt{2}}{3}');
  });

  it('takes the last \\boxed if multiple present', () => {
    expect(extractBoxed('First \\boxed{wrong} then \\boxed{right}')).toBe('right');
  });

  it('returns null when no \\boxed found', () => {
    expect(extractBoxed('The answer is 42')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractBoxed('')).toBeNull();
  });

  it('returns null for unbalanced braces', () => {
    expect(extractBoxed('\\boxed{unclosed')).toBeNull();
  });

  it('handles text answer', () => {
    expect(extractBoxed('\\boxed{\\text{Evelyn}}')).toBe('\\text{Evelyn}');
  });

  it('handles negative number', () => {
    expect(extractBoxed('\\boxed{-7}')).toBe('-7');
  });

  it('handles tuple/coordinate answer', () => {
    expect(extractBoxed('\\boxed{\\left( 3, \\frac{\\pi}{2} \\right)}')).toBe('\\left( 3, \\frac{\\pi}{2} \\right)');
  });
});

describe('normalizeLatex', () => {
  it('strips whitespace', () => {
    expect(normalizeLatex('  42  ')).toBe('42');
  });

  it('removes \\left and \\right', () => {
    expect(normalizeLatex('\\left( 3 \\right)')).toBe('(3)');
  });

  it('removes \\, thin space', () => {
    expect(normalizeLatex('1\\,000')).toBe('1000');
  });

  it('removes \\! negative thin space', () => {
    expect(normalizeLatex('a\\!b')).toBe('ab');
  });

  it('lowercases', () => {
    expect(normalizeLatex('\\frac{A}{B}')).toBe('\\frac{a}{b}');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeLatex('\\frac{ 14 }{ 3 }')).toBe('\\frac{14}{3}');
  });

  it('normalizes \\dfrac to \\frac', () => {
    expect(normalizeLatex('\\dfrac{1}{2}')).toBe('\\frac{1}{2}');
  });

  it('normalizes \\tfrac to \\frac', () => {
    expect(normalizeLatex('\\tfrac{1}{2}')).toBe('\\frac{1}{2}');
  });
});

describe('Math500Evaluator', () => {
  it('loads train split', () => {
    const evaluator = new Math500Evaluator('train');
    const items = evaluator.getAllItems();
    expect(items.length).toBe(250);
    expect(items[0].id).toBe('math500_train_0');
    expect(items[0].answer).toBe('\\left( 3, \\frac{\\pi}{2} \\right)');
  });

  it('loads eval split', () => {
    const evaluator = new Math500Evaluator('eval');
    const items = evaluator.getAllItems();
    expect(items.length).toBe(250);
    expect(items[0].id).toBe('math500_eval_0');
  });

  it('generateTasks returns tasks with prompts', () => {
    const evaluator = new Math500Evaluator('train');
    const tasks = evaluator.generateTasks(5);
    expect(tasks.length).toBe(5);
    expect(tasks[0].type).toBe('math500');
    expect(tasks[0].prompt).toContain('\\boxed{}');
  });

  it('score returns 1.0 for exact \\boxed match', () => {
    const evaluator = new Math500Evaluator('train');
    const tasks = evaluator.generateTasks(3);
    // train_2 has answer "\\frac{14}{3}"
    expect(evaluator.score(tasks[2], 'The answer is \\boxed{\\frac{14}{3}}')).toBe(1.0);
  });

  it('score returns fuzzy value for numerically close answer', () => {
    const evaluator = new Math500Evaluator('train');
    const tasks = evaluator.generateTasks(4);
    // train_3 has answer "9"
    expect(evaluator.score(tasks[3], '\\boxed{9}')).toBe(1.0);
    expect(evaluator.score(tasks[3], '\\boxed{10}')).toBeGreaterThan(0);
    expect(evaluator.score(tasks[3], '\\boxed{10}')).toBeLessThan(1);
    expect(evaluator.score(tasks[3], '\\boxed{999}')).toBe(0);
  });

  it('score returns 0 when no \\boxed found', () => {
    const evaluator = new Math500Evaluator('train');
    const tasks = evaluator.generateTasks(1);
    expect(evaluator.score(tasks[0], 'The answer is 42')).toBe(0);
  });

  it('scoreById returns binary 0/1', () => {
    const evaluator = new Math500Evaluator('train');
    // train_2 answer is "\\frac{14}{3}"
    expect(evaluator.scoreById('math500_train_2', '\\boxed{\\frac{14}{3}}')).toBe(1);
    expect(evaluator.scoreById('math500_train_2', '\\boxed{\\frac{15}{3}}')).toBe(0);
  });

  it('scoreById handles numeric equivalence', () => {
    const evaluator = new Math500Evaluator('train');
    // train_3 answer is "9"
    expect(evaluator.scoreById('math500_train_3', '\\boxed{9}')).toBe(1);
    expect(evaluator.scoreById('math500_train_3', '\\boxed{9.0}')).toBe(1);
    expect(evaluator.scoreById('math500_train_3', '\\boxed{10}')).toBe(0);
  });

  it('generateTasks cycles through items', () => {
    const evaluator = new Math500Evaluator('train');
    const batch1 = evaluator.generateTasks(3);
    const batch2 = evaluator.generateTasks(3);
    expect(batch1[0].id).toBe('math500_train_0');
    expect(batch2[0].id).toBe('math500_train_3');
  });
});
