// ================================================================
//  Scenario: Learning Curve
//  Claim 1 — Fitness improves over evolutionary cycles
// ================================================================

import { Ecology } from '../../src/evolution/ecology.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import type { EcologyStats } from '../../src/core/types.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

export async function learningCurve(
  seed: number,
  cycles = 30,
): Promise<BenchmarkResult> {
  return runBenchmark('learning-curve', seed, async (s) => {
    const rng = createSeededRng(s);
    resetGenomeCounter();

    const config = createDefaultConfig({
      strategyCount: 12,
      taskBatchSize: 12,
    });
    const evaluator = new MathEvaluator(rng);
    const ecology = new Ecology(config, new MockAdapter(), evaluator);

    const allStats: EcologyStats[] = [];
    const timeSeries: TimeSeriesPoint[] = [];

    for (let i = 0; i < cycles; i++) {
      const stats = await ecology.runCycle();
      allStats.push(stats);
      timeSeries.push({
        cycle: stats.cycle,
        avgFitness: stats.avgFitness,
        bestFitness: stats.bestFitness,
        strategyCount: stats.strategyCount,
      });
    }

    // Compute early vs late fitness
    const earlyWindow = 5;
    const lateStart = cycles - 5;
    const earlyStats = allStats.slice(0, earlyWindow);
    const lateStats = allStats.slice(lateStart);

    const earlyAvgFitness = earlyStats.reduce((s, x) => s + x.avgFitness, 0) / earlyStats.length;
    const lateAvgFitness = lateStats.reduce((s, x) => s + x.avgFitness, 0) / lateStats.length;

    // Linear regression slope on avgFitness
    const n = allStats.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += allStats[i].avgFitness;
      sumXY += i * allStats[i].avgFitness;
      sumXX += i * i;
    }
    const slopeAvgFitness = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    const improvementRatio = earlyAvgFitness !== 0
      ? (lateAvgFitness - earlyAvgFitness) / Math.abs(earlyAvgFitness)
      : lateAvgFitness > earlyAvgFitness ? 1 : 0;

    const passed = lateAvgFitness > earlyAvgFitness && slopeAvgFitness > 0;

    return {
      passed,
      metrics: {
        earlyAvgFitness,
        lateAvgFitness,
        slopeAvgFitness,
        improvementRatio,
      },
      timeSeries,
      details: passed
        ? `Fitness improved from ${earlyAvgFitness.toFixed(2)} to ${lateAvgFitness.toFixed(2)} (+${(improvementRatio * 100).toFixed(0)}%)`
        : `Fitness did NOT improve: early=${earlyAvgFitness.toFixed(2)}, late=${lateAvgFitness.toFixed(2)}`,
    };
  });
}
