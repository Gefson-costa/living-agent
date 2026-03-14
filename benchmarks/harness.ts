// ================================================================
//  Benchmark Harness — Types, utilities, runner, MultiTypeEvaluator
// ================================================================

import type { Task, TaskEvaluator } from '../src/core/types.js';
import { MathEvaluator } from '../src/fitness/evaluator.js';

// ── Types ───────────────────────────────────────────────────────

export interface TimeSeriesPoint {
  cycle: number;
  [key: string]: number;
}

export interface BenchmarkResult {
  name: string;
  passed: boolean;
  durationMs: number;
  seed: number;
  metrics: Record<string, number>;
  timeSeries: TimeSeriesPoint[];
  details: string;
}

export type BenchmarkFn = (seed: number) => Promise<BenchmarkResult>;

// ── Seeded RNG ──────────────────────────────────────────────────

export function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

// ── Run Benchmark Wrapper ───────────────────────────────────────

export async function runBenchmark(
  name: string,
  seed: number,
  fn: (seed: number) => Promise<Omit<BenchmarkResult, 'name' | 'durationMs' | 'seed'>>,
): Promise<BenchmarkResult> {
  const start = performance.now();
  const partial = await fn(seed);
  const durationMs = performance.now() - start;
  return { name, seed, durationMs, ...partial };
}

// ── Multi-Type Evaluator ────────────────────────────────────────
//
// Wraps MathEvaluator but labels tasks with the 6 canonical task
// types, each mapped to a different difficulty range. This lets
// specialization benchmarks observe strategies developing per-type
// preferences.

const TASK_TYPE_DIFFICULTY: Record<string, [number, number]> = {
  research:      [0.0, 0.25],   // easiest
  coding:        [0.15, 0.50],
  summarization: [0.20, 0.55],
  creative:      [0.30, 0.65],
  general:       [0.40, 0.75],
  analysis:      [0.60, 1.00],  // hardest
};

const MULTI_TYPES = Object.keys(TASK_TYPE_DIFFICULTY);

export class MultiTypeEvaluator implements TaskEvaluator {
  private inner: MathEvaluator;
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.inner = new MathEvaluator(rng);
  }

  generateTasks(count: number): Task[] {
    const tasks = this.inner.generateTasks(count);
    return tasks.map((task) => {
      const typeIdx = (this.rng() * MULTI_TYPES.length) | 0;
      const type = MULTI_TYPES[Math.min(typeIdx, MULTI_TYPES.length - 1)];
      const [lo, hi] = TASK_TYPE_DIFFICULTY[type];
      const difficulty = lo + this.rng() * (hi - lo);
      return { ...task, type, difficulty };
    });
  }

  score(task: Task, response: string): number {
    return this.inner.score(task, response);
  }
}
