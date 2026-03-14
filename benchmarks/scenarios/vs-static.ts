// ================================================================
//  Scenario: Evolution vs Static
//  Claim 2 — Evolution surpasses a hand-tuned fixed strategy
// ================================================================

import { Ecology } from '../../src/evolution/ecology.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { StaticBaseline } from '../baselines.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

export async function vsStatic(
  seed: number,
  cycles = 30,
): Promise<BenchmarkResult> {
  return runBenchmark('vs-static', seed, async (s) => {
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

    // Run static baseline with same seed
    resetGenomeCounter();
    const staticEval = new MathEvaluator(rng2);
    const staticBaseline = new StaticBaseline(config, new MockAdapter(), staticEval);
    const staticStats = await staticBaseline.run(cycles);

    const timeSeries: TimeSeriesPoint[] = ecologyStats.map((es, i) => ({
      cycle: es.cycle,
      ecologyAvgFitness: es.avgFitness,
      ecologyBestFitness: es.bestFitness,
      staticFitness: staticStats[i].bestFitness,
    }));

    const ecologyFinalBest = ecologyStats[ecologyStats.length - 1].bestFitness;
    const ecologyFinalAvg = ecologyStats[ecologyStats.length - 1].avgFitness;
    const staticFinalBest = staticStats[staticStats.length - 1].bestFitness;
    const staticFinalAvg = staticStats[staticStats.length - 1].avgFitness;
    const avgFitnessAdvantage = ecologyFinalAvg - staticFinalAvg;

    // Find cycle where ecology best first surpassed static best
    let cycleWhereSurpassed = -1;
    for (let i = 0; i < ecologyStats.length; i++) {
      if (ecologyStats[i].bestFitness > staticStats[i].bestFitness) {
        cycleWhereSurpassed = ecologyStats[i].cycle;
        break;
      }
    }

    const passed = ecologyFinalBest > staticFinalBest;

    return {
      passed,
      metrics: {
        ecologyFinalBest,
        ecologyFinalAvg,
        staticFinalBest,
        staticFinalAvg,
        avgFitnessAdvantage,
        cycleWhereSurpassed,
      },
      timeSeries,
      details: passed
        ? `Ecology best (${ecologyFinalBest.toFixed(2)}) > Static best (${staticFinalBest.toFixed(2)}), surpassed at cycle ${cycleWhereSurpassed}`
        : `Ecology (${ecologyFinalBest.toFixed(2)}) did NOT surpass static (${staticFinalBest.toFixed(2)})`,
    };
  });
}
