import { describe, it, expect } from 'vitest';
import { MathEvaluator } from '../src/fitness/evaluator.js';

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function solveExpr(prompt: string): number | null {
  const m = prompt.match(/Calculate:\s*(-?\d+\.?\d*)\s*([+\-*/\u00f7\u00d7])\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const op = m[2];
  const b = parseFloat(m[3]);
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': case '\u00d7': return a * b;
    case '/': case '\u00f7': return b !== 0 ? a / b : null;
    default: return null;
  }
}

describe('MathEvaluator', () => {
  it('generates tasks', () => {
    const rng = mulberry32(1);
    const evaluator = new MathEvaluator(rng);
    const tasks = evaluator.generateTasks(5);

    expect(tasks.length).toBe(5);
    for (const task of tasks) {
      expect(task.id).toBeTruthy();
      expect(task.type).toBeTruthy();
      expect(task.prompt).toContain('Calculate');
      expect(task.difficulty).toBeGreaterThanOrEqual(0);
      expect(task.difficulty).toBeLessThanOrEqual(1);
    }
  });

  it('scores correct answer as 1.0', () => {
    const rng = mulberry32(2);
    const evaluator = new MathEvaluator(rng);
    const tasks = evaluator.generateTasks(10);

    let perfectCount = 0;
    for (const task of tasks) {
      const answer = solveExpr(task.prompt);
      if (answer !== null) {
        const score = evaluator.score(task, String(answer));
        if (score === 1.0) perfectCount++;
      }
    }
    expect(perfectCount).toBeGreaterThan(0);
  });

  it('scores wrong answer as 0', () => {
    const rng = mulberry32(3);
    const evaluator = new MathEvaluator(rng);
    const tasks = evaluator.generateTasks(1);

    const score = evaluator.score(tasks[0], 'not a number');
    expect(score).toBe(0);
  });

  it('scores approximately correct answers partially', () => {
    const rng = mulberry32(4);
    const evaluator = new MathEvaluator(rng);
    const tasks = evaluator.generateTasks(10);

    for (const task of tasks) {
      const answer = solveExpr(task.prompt);
      if (answer !== null && Math.abs(answer) > 1) {
        const approximate = answer * 1.03;
        const score = evaluator.score(task, String(approximate));
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
        return;
      }
    }
    expect(true).toBe(true);
  });
});
