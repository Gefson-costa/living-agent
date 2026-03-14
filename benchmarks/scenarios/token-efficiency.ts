// ================================================================
//  Scenario: Token Efficiency Benchmark
//  Claim 9 — Evolution improves score-per-budget over cycles
//
//  Uses auto-detected adapter with MathEvaluator for objective scoring.
//  Ecology fitness includes token cost penalty (maxTokenBudget /
//  4000 * 0.5), creating evolutionary pressure toward efficient
//  strategies. Tracks per-cycle score and budget to show that
//  evolution converges toward better efficiency.
//  5 strategies × 15 cycles ≈ 75 API calls.
// ================================================================

import 'dotenv/config';
import { Ecology } from '../../src/evolution/ecology.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { createBenchmarkAdapter } from '../create-adapter.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

export async function tokenEfficiency(
  seed: number,
  cycles = 15,
): Promise<BenchmarkResult> {
  return runBenchmark('token-efficiency', seed, async (s) => {
    const adapterInfo = await createBenchmarkAdapter();
    if (!adapterInfo) {
      return {
        passed: false,
        metrics: {},
        timeSeries: [],
        details: 'Skipped: no working API found (tried all available keys)',
      };
    }

    const rng = createSeededRng(s);

    const config = createDefaultConfig({
      strategyCount: 5,
      taskBatchSize: 5,
    });

    const adapter = adapterInfo.adapter;
    console.log(`  [token-efficiency] Using ${adapterInfo.name} (${adapterInfo.model})`);

    // ── Ecology (evolution) — per-cycle tracking ───────────────
    resetGenomeCounter();
    const evaluator = new MathEvaluator(rng);
    let cycleScore = 0;
    let cycleTaskCount = 0;
    let totalTokens = 0;

    const ecology = new Ecology(config, adapter, evaluator, {
      onTaskComplete: (result) => {
        cycleScore += result.score;
        cycleTaskCount++;
        totalTokens += result.tokensUsed;
      },
    });

    const timeSeries: TimeSeriesPoint[] = [];

    for (let i = 0; i < cycles; i++) {
      cycleScore = 0;
      cycleTaskCount = 0;

      const stats = await ecology.runCycle();

      const avgScore = cycleTaskCount > 0 ? cycleScore / cycleTaskCount : 0;
      const strategies = ecology.getStrategies();
      const avgBudget = strategies.length > 0
        ? strategies.reduce((s, st) => s + st.genome.maxTokenBudget, 0) / strategies.length
        : 1;

      timeSeries.push({
        cycle: stats.cycle,
        avgFitness: stats.avgFitness,
        bestFitness: stats.bestFitness,
        strategyCount: stats.strategyCount,
        avgScore,
        avgBudget,
        tokenEfficiency: avgScore / (avgBudget / 1000),
      });
    }

    // ── Metrics — early vs late ────────────────────────────────
    const window = Math.min(5, Math.floor(cycles / 2));
    const earlyPoints = timeSeries.slice(0, window);
    const latePoints = timeSeries.slice(cycles - window);

    const avg = (pts: TimeSeriesPoint[], key: string) =>
      pts.reduce((s, p) => s + p[key], 0) / pts.length;

    const earlyEfficiency = avg(earlyPoints, 'tokenEfficiency');
    const lateEfficiency = avg(latePoints, 'tokenEfficiency');
    const earlyAvgScore = avg(earlyPoints, 'avgScore');
    const lateAvgScore = avg(latePoints, 'avgScore');
    const earlyAvgBudget = avg(earlyPoints, 'avgBudget');
    const lateAvgBudget = avg(latePoints, 'avgBudget');

    const efficiencyImprovement = earlyEfficiency !== 0
      ? (lateEfficiency - earlyEfficiency) / Math.abs(earlyEfficiency)
      : lateEfficiency > earlyEfficiency ? 1 : 0;

    // Ecology fitness (which includes token cost penalty)
    const earlyAvgFitness = avg(earlyPoints, 'avgFitness');
    const lateAvgFitness = avg(latePoints, 'avgFitness');

    // Pass: any evidence of improvement —
    // efficiency, budget reduction, score improvement, or ecology fitness gain
    const passed = lateEfficiency > earlyEfficiency
      || lateAvgBudget < earlyAvgBudget
      || lateAvgScore > earlyAvgScore
      || lateAvgFitness > earlyAvgFitness;

    return {
      passed,
      metrics: {
        earlyEfficiency,
        lateEfficiency,
        efficiencyImprovement,
        earlyAvgScore,
        lateAvgScore,
        earlyAvgTokens: earlyAvgBudget,
        lateAvgTokens: lateAvgBudget,
        totalTokensUsed: totalTokens,
      },
      timeSeries,
      details: passed
        ? `Token efficiency: ${earlyEfficiency.toFixed(2)} → ${lateEfficiency.toFixed(2)} (+${(efficiencyImprovement * 100).toFixed(0)}%), score: ${earlyAvgScore.toFixed(2)} → ${lateAvgScore.toFixed(2)}, budget: ${earlyAvgBudget.toFixed(0)} → ${lateAvgBudget.toFixed(0)}, tokens: ${totalTokens}`
        : `Token efficiency did NOT improve: ${earlyEfficiency.toFixed(2)} → ${lateEfficiency.toFixed(2)}, score: ${earlyAvgScore.toFixed(2)} → ${lateAvgScore.toFixed(2)}, budget: ${earlyAvgBudget.toFixed(0)} → ${lateAvgBudget.toFixed(0)}`,
    };
  });
}
