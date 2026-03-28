// ================================================================
//  Scenario: Diversity Preservation
//  Claim 5 — MAP-Elites + novelty maintain useful diversity
// ================================================================

import { Ecology } from '../../src/evolution/ecology.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter, geneticDistance } from '../../src/evolution/genome.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

function meanPairwiseDistance(strategies: readonly { genome: import('../../src/core/types.js').StrategyGenome }[]): number {
  if (strategies.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      sum += geneticDistance(strategies[i].genome, strategies[j].genome);
      count++;
    }
  }
  return sum / count;
}

export async function diversity(
  seed: number,
  cycles = 30,
): Promise<BenchmarkResult> {
  return runBenchmark('diversity', seed, async (s) => {
    const rng1 = createSeededRng(s);
    const rng2 = createSeededRng(s);

    // With novelty (default: noveltyWeight 0.8)
    // Uses higher mutation rate and lenient culling because this test measures
    // diversity preservation, not fitness. MockAdapter + strict reward center
    // produces uniformly negative fitness — lenient culling keeps the population alive.
    resetGenomeCounter();
    const config1 = createDefaultConfig({
      strategyCount: 12,
      taskBatchSize: 12,
      noveltyWeight: 0.8,
      mutationRate: 0.6,
      cullThreshold: -20,
    });
    const ecology1 = new Ecology(config1, new MockAdapter(), new MathEvaluator(rng1));
    const stats1 = await ecology1.run(cycles);

    // Without novelty
    resetGenomeCounter();
    const config2 = createDefaultConfig({
      strategyCount: 12,
      taskBatchSize: 12,
      noveltyWeight: 0,
      mutationRate: 0.6,
      cullThreshold: -20,
    });
    const ecology2 = new Ecology(config2, new MockAdapter(), new MathEvaluator(rng2));
    const stats2 = await ecology2.run(cycles);

    const timeSeries: TimeSeriesPoint[] = stats1.map((s1, i) => ({
      cycle: s1.cycle,
      noveltyAvgFitness: s1.avgFitness,
      noNoveltyAvgFitness: stats2[i].avgFitness,
      noveltyArchiveSize: s1.noveltyArchiveSize,
    }));

    const meanDist = meanPairwiseDistance(ecology1.getStrategies());
    const noNoveltyMeanDist = meanPairwiseDistance(ecology2.getStrategies());
    const mapElitesCoverage = stats1[stats1.length - 1].mapElitesCoverage;
    const noveltyArchiveSize = stats1[stats1.length - 1].noveltyArchiveSize;

    // Pass criteria: diversity maintained above threshold AND novelty archive populated
    const passed = meanDist > 0.05 && noveltyArchiveSize > 0 && mapElitesCoverage > 0;

    return {
      passed,
      metrics: {
        meanGeneticDistance: meanDist,
        noNoveltyMeanDistance: noNoveltyMeanDist,
        mapElitesCoverage,
        noveltyArchiveSize,
        diversityAdvantage: meanDist - noNoveltyMeanDist,
      },
      timeSeries,
      details: passed
        ? `Mean distance: ${meanDist.toFixed(3)}, archive: ${noveltyArchiveSize}, MAP-Elites: ${(mapElitesCoverage * 100).toFixed(0)}%`
        : `Diversity check failed: dist=${meanDist.toFixed(3)} (min 0.05), archive=${noveltyArchiveSize}, coverage=${mapElitesCoverage}`,
    };
  });
}
