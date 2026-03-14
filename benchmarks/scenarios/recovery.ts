// ================================================================
//  Scenario: Crash Recovery
//  Claim 6 — System recovers from population crash
// ================================================================

import { Ecology } from '../../src/evolution/ecology.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

export async function recovery(
  seed: number,
  totalCycles = 30,
): Promise<BenchmarkResult> {
  const halfCycles = Math.floor(totalCycles / 2);

  return runBenchmark('recovery', seed, async (s) => {
    const rng = createSeededRng(s);
    resetGenomeCounter();

    const config = createDefaultConfig({
      strategyCount: 12,
      taskBatchSize: 12,
    });
    const evaluator = new MathEvaluator(rng);
    const ecology = new Ecology(config, new MockAdapter(), evaluator);

    const timeSeries: TimeSeriesPoint[] = [];

    // Phase 1: Build up the ecology
    for (let i = 0; i < halfCycles; i++) {
      const stats = await ecology.runCycle();
      timeSeries.push({
        cycle: stats.cycle,
        avgFitness: stats.avgFitness,
        strategyCount: stats.strategyCount,
        phase: 1,
      });
    }

    const prePerturbation = ecology.getStats();
    const prePerturbationAvg = prePerturbation.avgFitness;
    const prePerturbationBest = prePerturbation.bestFitness;
    const prePerturbationPop = prePerturbation.strategyCount;

    // Kill 80% of the population
    ecology.killFraction(0.8);
    const postKillStats = ecology.getStats();
    const postKillPop = postKillStats.strategyCount;
    const postKillBest = postKillStats.bestFitness;

    timeSeries.push({
      cycle: prePerturbation.cycle + 0.5,
      bestFitness: postKillBest,
      strategyCount: postKillPop,
      phase: 0,  // crash marker
    });

    // Phase 2: Recovery
    for (let i = 0; i < halfCycles; i++) {
      const stats = await ecology.runCycle();
      timeSeries.push({
        cycle: stats.cycle,
        bestFitness: stats.bestFitness,
        strategyCount: stats.strategyCount,
        phase: 2,
      });
    }

    const recovered = ecology.getStats();
    const recoveredPop = recovered.strategyCount;
    const recoveredBest = recovered.bestFitness;
    const recoveryRatio = prePerturbationPop > 0
      ? recoveredPop / prePerturbationPop
      : 0;

    // Recovery means: population grew back AND best fitness stayed competitive
    const passed = recoveredPop > postKillPop && recoveredBest >= prePerturbationBest * 0.5;

    return {
      passed,
      metrics: {
        prePerturbationAvg,
        prePerturbationBest,
        prePerturbationPop,
        postKillPop,
        postKillBest,
        recoveredPop,
        recoveredBest,
        recoveryRatio,
      },
      timeSeries,
      details: passed
        ? `Pop recovered ${postKillPop} → ${recoveredPop} (${(recoveryRatio * 100).toFixed(0)}% of original), best fitness: ${postKillBest.toFixed(2)} → ${recoveredBest.toFixed(2)}`
        : `Recovery failed: pop ${postKillPop} → ${recoveredPop}, best fitness ${postKillBest.toFixed(2)} → ${recoveredBest.toFixed(2)}`,
    };
  });
}
