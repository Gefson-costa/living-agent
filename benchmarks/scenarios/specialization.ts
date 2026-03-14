// ================================================================
//  Scenario: Specialization
//  Claim 4 — Strategies develop task-type preferences
// ================================================================

import { Ecology } from '../../src/evolution/ecology.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { createSeededRng, MultiTypeEvaluator, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

export async function specialization(
  seed: number,
  cycles = 30,
): Promise<BenchmarkResult> {
  return runBenchmark('specialization', seed, async (s) => {
    const rng = createSeededRng(s);
    resetGenomeCounter();

    const config = createDefaultConfig({
      strategyCount: 12,
      taskBatchSize: 12,
    });
    const evaluator = new MultiTypeEvaluator(rng);
    const ecology = new Ecology(config, new MockAdapter(), evaluator);

    const timeSeries: TimeSeriesPoint[] = [];
    for (let i = 0; i < cycles; i++) {
      const stats = await ecology.runCycle();
      timeSeries.push({
        cycle: stats.cycle,
        avgFitness: stats.avgFitness,
        strategyCount: stats.strategyCount,
      });
    }

    // Analyze specialization in surviving strategies
    const strategies = ecology.getStrategies();
    let totalSpecialization = 0;
    let numSpecialists = 0;
    const specializations = new Set<string>();

    for (const strategy of strategies) {
      const mem = strategy.taskTypeMemory;
      if (mem.size === 0) continue;

      // Find best and compute specialization score
      let maxScore = 0;
      let bestType = '';
      let sumScores = 0;
      for (const [type, score] of mem) {
        sumScores += score;
        if (score > maxScore) {
          maxScore = score;
          bestType = type;
        }
      }

      // Specialization = max expertise relative to average
      const avgScore = sumScores / mem.size;
      const specScore = mem.size > 1 ? (maxScore - avgScore) / Math.max(0.01, avgScore) : 0;
      totalSpecialization += specScore;

      if (maxScore > 0.7) {
        numSpecialists++;
        specializations.add(bestType);
      }
    }

    const avgSpecialization = strategies.length > 0
      ? totalSpecialization / strategies.length
      : 0;
    const uniqueSpecializations = specializations.size;

    const passed = numSpecialists > 0;

    return {
      passed,
      metrics: {
        avgSpecialization,
        numSpecialists,
        uniqueSpecializations,
        totalStrategies: strategies.length,
      },
      timeSeries,
      details: passed
        ? `${numSpecialists}/${strategies.length} specialists across ${uniqueSpecializations} types`
        : 'No strategies developed specialization above threshold (0.7)',
    };
  });
}
