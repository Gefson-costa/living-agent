#!/usr/bin/env tsx
// ================================================================
//  Benchmark Runner — CLI entry point
//  Usage: npx tsx benchmarks/run.ts [--seed=42] [--cycles=30] [--verbose] [--scenario=NAME] [--real]
// ================================================================

import 'dotenv/config';
import { learningCurve } from './scenarios/learning-curve.js';
import { vsStatic } from './scenarios/vs-static.js';
import { vsRandom } from './scenarios/vs-random.js';
import { specialization } from './scenarios/specialization.js';
import { diversity } from './scenarios/diversity.js';
import { recovery } from './scenarios/recovery.js';
import { realLlm } from './scenarios/real-llm.js';
import { realLlmComplex } from './scenarios/real-llm-complex.js';
import { tokenEfficiency } from './scenarios/token-efficiency.js';
import { realLlmSpecialization } from './scenarios/real-llm-specialization.js';
import { gsm8kVsDspy } from './scenarios/gsm8k-vs-dspy.js';
import { math500VsDspy } from './scenarios/math500-vs-dspy.js';
import { multitaskSpecialization } from './scenarios/multitask-specialization.js';
import { swebench } from './scenarios/swebench.js';
import { ablationMath500 } from './scenarios/ablation-math500.js';
import { headtohead } from './scenarios/headtohead.js';
import { logiqa } from './scenarios/logiqa.js';
import type { BenchmarkResult } from './harness.js';

// ── Parse CLI args ──────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let seed = 42;
  let cycles = 30;
  let verbose = false;
  let scenario: string | null = null;
  let real = false;

  for (const arg of args) {
    if (arg.startsWith('--seed=')) seed = parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--cycles=')) cycles = parseInt(arg.slice(9), 10);
    else if (arg === '--verbose') verbose = true;
    else if (arg.startsWith('--scenario=')) scenario = arg.slice(11);
    else if (arg === '--real') real = true;
  }

  return { seed, cycles, verbose, scenario, real };
}

// ── Scenarios Registry ──────────────────────────────────────────

const SYNTHETIC_SCENARIOS: Record<string, (seed: number, cycles: number) => Promise<BenchmarkResult>> = {
  'learning-curve': learningCurve,
  'vs-static': vsStatic,
  'vs-random': vsRandom,
  specialization,
  diversity,
  recovery,
};

const REAL_SCENARIOS: Record<string, (seed: number, cycles: number) => Promise<BenchmarkResult>> = {
  'real-llm': realLlm,
  'real-llm-complex': realLlmComplex,
  'token-efficiency': tokenEfficiency,
  'real-llm-specialization': realLlmSpecialization,
  'gsm8k-vs-dspy': gsm8kVsDspy,
  'math500-vs-dspy': math500VsDspy,
  'multitask-specialization': multitaskSpecialization,
  'swebench': swebench,
  'ablation-math500': ablationMath500,
  'headtohead': headtohead,
  'logiqa': logiqa,
};

// ── Runner ──────────────────────────────────────────────────────

async function main() {
  const { seed, cycles, verbose, scenario, real } = parseArgs();

  const SCENARIOS = real ? REAL_SCENARIOS : SYNTHETIC_SCENARIOS;
  const names = scenario ? [scenario] : Object.keys(SCENARIOS);
  const results: BenchmarkResult[] = [];
  const totalStart = performance.now();

  const label = real ? 'Real LLM' : 'Synthetic';
  console.log(`\nLiving Agent ${label} Benchmark Results (seed: ${seed})`);
  console.log('='.repeat(60));
  console.log(
    'Scenario'.padEnd(22) +
    'Status'.padEnd(9) +
    'Time'.padEnd(8) +
    'Key Metric',
  );

  for (const name of names) {
    const fn = SCENARIOS[name];
    if (!fn) {
      console.error(`Unknown scenario: ${name}`);
      process.exit(1);
    }

    const result = await fn(seed, cycles);
    results.push(result);

    const status = result.passed ? 'PASS' : 'FAIL';
    const time = `${(result.durationMs / 1000).toFixed(1)}s`;
    const keyMetric = getKeyMetric(result);

    console.log(
      name.padEnd(22) +
      (result.passed ? status : `\x1b[31m${status}\x1b[0m`).padEnd(result.passed ? 9 : 20) +
      time.padEnd(8) +
      keyMetric,
    );

    if (verbose) {
      console.log(`  Details: ${result.details}`);
      for (const [k, v] of Object.entries(result.metrics)) {
        console.log(`    ${k}: ${typeof v === 'number' ? v.toFixed(4) : v}`);
      }
      if (result.timeSeries.length > 0) {
        console.log(`  Time series: ${result.timeSeries.length} points`);
      }
      console.log();
    }
  }

  const totalMs = performance.now() - totalStart;
  const passed = results.filter(r => r.passed).length;

  console.log('='.repeat(60));
  console.log(`${passed}/${results.length} passed (${(totalMs / 1000).toFixed(1)}s total)`);

  // JSON output for programmatic consumption
  if (process.env.BENCH_JSON === '1') {
    console.log('\n' + JSON.stringify({ seed, cycles, results }, null, 2));
  }

  process.exit(passed === results.length ? 0 : 1);
}

function getKeyMetric(result: BenchmarkResult): string {
  const m = result.metrics;
  switch (result.name) {
    case 'learning-curve':
      return `improvement: +${((m.improvementRatio ?? 0) * 100).toFixed(0)}%`;
    case 'vs-static':
      return `advantage: ${(m.avgFitnessAdvantage ?? 0) >= 0 ? '+' : ''}${(m.avgFitnessAdvantage ?? 0).toFixed(2)}`;
    case 'vs-random':
      return `advantage: ${(m.bestFitnessAdvantage ?? 0) >= 0 ? '+' : ''}${(m.bestFitnessAdvantage ?? 0).toFixed(2)}`;
    case 'specialization':
      return `specialists: ${m.numSpecialists ?? 0}/${m.totalStrategies ?? 0}`;
    case 'diversity':
      return `mean distance: ${(m.meanGeneticDistance ?? 0).toFixed(2)}`;
    case 'recovery':
      return `recovery: ${((m.recoveryRatio ?? 0) * 100).toFixed(0)}%`;
    case 'real-llm':
    case 'real-llm-complex':
      return `improvement: +${((m.improvementRatio ?? 0) * 100).toFixed(0)}%, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'token-efficiency':
      return `efficiency: +${((m.efficiencyImprovement ?? 0) * 100).toFixed(0)}%, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'real-llm-specialization':
      return `specialists: ${m.numSpecialists ?? 0}/${m.totalStrategies ?? 0}, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'gsm8k-vs-dspy':
    case 'math500-vs-dspy':
      return `accuracy: ${((m.livingAgentAccuracy ?? 0) * 100).toFixed(1)}%` +
        (m.dspyZeroshotAccuracy !== undefined ? ` vs DSPy ${((m.dspyZeroshotAccuracy) * 100).toFixed(1)}%` : '') +
        `, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'multitask-specialization':
      return `evolved: ${((m.evolvedOverallAccuracy ?? 0) * 100).toFixed(1)}% vs static: ${((m.staticOverallAccuracy ?? 0) * 100).toFixed(1)}%, specialists: ${m.distinctSpecialists ?? 0}, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'swebench':
      return `evolved: ${((m.livingAgentAccuracy ?? 0) * 100).toFixed(1)}% vs static: ${((m.staticBaselineAccuracy ?? 0) * 100).toFixed(1)}%, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'ablation-math500':
      return `control: ${((m.control_accuracy ?? 0) * 100).toFixed(1)}%, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'headtohead':
      return `LA: ${((m.livingAgentAccuracy ?? 0) * 100).toFixed(1)}%, tokens: ${m.totalTokensUsed ?? 0}`;
    case 'logiqa':
      return `evolved: ${((m.livingAgentAccuracy ?? 0) * 100).toFixed(1)}% vs static: ${((m.staticAccuracy ?? 0) * 100).toFixed(1)}%, tokens: ${m.totalTokensUsed ?? 0}`;
    default:
      return result.details.slice(0, 40);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
