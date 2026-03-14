// ================================================================
//  Scenario: Real LLM Benchmark
//  Claim 7 — Evolution improves real LLM math scores
//
//  Uses auto-detected adapter with MathEvaluator for objective scoring.
//  Compares ecology (evolution) vs static baseline over 10 cycles.
//  Minimizes API cost: 5 strategies × 10 cycles ≈ 50 calls.
// ================================================================

import 'dotenv/config';
import { Ecology } from '../../src/evolution/ecology.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { StaticBaseline } from '../baselines.js';
import { createBenchmarkAdapter } from '../create-adapter.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

export async function realLlm(
  seed: number,
  cycles = 10,
): Promise<BenchmarkResult> {
  return runBenchmark('real-llm', seed, async (s) => {
    const adapterInfo = await createBenchmarkAdapter();
    if (!adapterInfo) {
      return {
        passed: false,
        metrics: {},
        timeSeries: [],
        details: 'Skipped: no working API found (tried all available keys)',
      };
    }

    const rng1 = createSeededRng(s);
    const rng2 = createSeededRng(s);

    const config = createDefaultConfig({
      strategyCount: 5,
      taskBatchSize: 5,
    });

    const adapter = adapterInfo.adapter;
    console.log(`  [real-llm] Using ${adapterInfo.name} (${adapterInfo.model})`);

    // ── Ecology (evolution) ──────────────────────────────────────
    resetGenomeCounter();
    const ecologyEval = new MathEvaluator(rng1);
    let ecologyTokens = 0;
    const ecology = new Ecology(config, adapter, ecologyEval, {
      onTaskComplete: (result) => { ecologyTokens += result.tokensUsed; },
    });

    const ecologyStats = [];
    const timeSeries: TimeSeriesPoint[] = [];

    for (let i = 0; i < cycles; i++) {
      const stats = await ecology.runCycle();
      ecologyStats.push(stats);
      timeSeries.push({
        cycle: stats.cycle,
        avgFitness: stats.avgFitness,
        bestFitness: stats.bestFitness,
        strategyCount: stats.strategyCount,
      });
    }

    // ── Static baseline ──────────────────────────────────────────
    resetGenomeCounter();
    const staticEval = new MathEvaluator(rng2);
    let staticTokens = 0;
    const staticAdapter: typeof adapter = new Proxy(adapter, {
      get(target, prop, receiver) {
        if (prop === 'execute') {
          return async (...args: Parameters<typeof adapter.execute>) => {
            const result = await target.execute(...args);
            staticTokens += result.tokensUsed;
            return result;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const staticBaseline = new StaticBaseline(config, staticAdapter, staticEval);
    const staticStats = await staticBaseline.run(cycles);

    // ── Metrics ──────────────────────────────────────────────────
    const earlyWindow = Math.min(3, cycles);
    const lateStart = Math.max(0, cycles - 3);
    const earlyStats = ecologyStats.slice(0, earlyWindow);
    const lateStats = ecologyStats.slice(lateStart);

    const earlyAvgFitness = earlyStats.reduce((s, x) => s + x.avgFitness, 0) / earlyStats.length;
    const lateAvgFitness = lateStats.reduce((s, x) => s + x.avgFitness, 0) / lateStats.length;

    const ecologyFinalBest = ecologyStats[ecologyStats.length - 1].bestFitness;
    const staticFinalBest = staticStats[staticStats.length - 1].bestFitness;

    const improvementRatio = earlyAvgFitness !== 0
      ? (lateAvgFitness - earlyAvgFitness) / Math.abs(earlyAvgFitness)
      : lateAvgFitness > earlyAvgFitness ? 1 : 0;

    // Pass criterion: late fitness > early fitness (evolution improves over cycles)
    const passed = lateAvgFitness > earlyAvgFitness;

    return {
      passed,
      metrics: {
        earlyAvgFitness,
        lateAvgFitness,
        ecologyFinalBest,
        staticFinalBest,
        improvementRatio,
        totalTokensUsed: ecologyTokens,
        staticTokensUsed: staticTokens,
      },
      timeSeries,
      details: passed
        ? `Real LLM fitness improved: ${earlyAvgFitness.toFixed(2)} → ${lateAvgFitness.toFixed(2)} (+${(improvementRatio * 100).toFixed(0)}%), ecology best=${ecologyFinalBest.toFixed(2)} vs static=${staticFinalBest.toFixed(2)}, tokens: ${ecologyTokens}+${staticTokens}`
        : `Real LLM fitness did NOT improve: early=${earlyAvgFitness.toFixed(2)}, late=${lateAvgFitness.toFixed(2)}, tokens: ${ecologyTokens}+${staticTokens}`,
    };
  });
}
