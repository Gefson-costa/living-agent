// ================================================================
//  Scenario: Evolution vs Random
//  Claim 3 — Intelligent selection outperforms random selection
// ================================================================

import { Ecology } from '../../src/evolution/ecology.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { RandomBaseline } from '../baselines.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

export async function vsRandom(
  seed: number,
  cycles = 20,
): Promise<BenchmarkResult> {
  return runBenchmark('vs-random', seed, async (s) => {
    const rng1 = createSeededRng(s);
    const rng2 = createSeededRng(s);

    const config = createDefaultConfig({
      strategyCount: 12,
      taskBatchSize: 12,
    });

    // Run ecology
    resetGenomeCounter();
    const ecologyEval = new MathEvaluator(rng1);
    const ecology = new Ecology(config, new MockAdapter(), ecologyEval);
    const ecologyStats = await ecology.run(cycles);

    // Run random baseline
    resetGenomeCounter();
    const randomEval = new MathEvaluator(rng2);
    const randomBaseline = new RandomBaseline(config, new MockAdapter(), randomEval, rng2);
    const randomStats = await randomBaseline.run(cycles);

    const timeSeries: TimeSeriesPoint[] = ecologyStats.map((es, i) => ({
      cycle: es.cycle,
      ecologyAvgFitness: es.avgFitness,
      randomAvgFitness: randomStats[i].avgFitness,
    }));

    const ecologyFinalAvg = ecologyStats[ecologyStats.length - 1].avgFitness;
    const ecologyFinalBest = ecologyStats[ecologyStats.length - 1].bestFitness;
    const randomFinalAvg = randomStats[randomStats.length - 1].avgFitness;
    const randomFinalBest = randomStats[randomStats.length - 1].bestFitness;
    const avgFitnessAdvantage = ecologyFinalAvg - randomFinalAvg;
    const bestFitnessAdvantage = ecologyFinalBest - randomFinalBest;

    // Evolution should produce a better best strategy than random
    const passed = ecologyFinalBest > randomFinalBest;

    return {
      passed,
      metrics: {
        ecologyFinalAvg,
        ecologyFinalBest,
        randomFinalAvg,
        randomFinalBest,
        avgFitnessAdvantage,
        bestFitnessAdvantage,
      },
      timeSeries,
      details: passed
        ? `Ecology best (${ecologyFinalBest.toFixed(2)}) > Random best (${randomFinalBest.toFixed(2)}), advantage: +${bestFitnessAdvantage.toFixed(2)}`
        : `Ecology best (${ecologyFinalBest.toFixed(2)}) did NOT beat random best (${randomFinalBest.toFixed(2)})`,
    };
  });
}
