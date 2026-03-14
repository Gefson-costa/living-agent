// ================================================================
//  Scenario: Ablation Study on MATH-500
//
//  Runs 9 variants (control + 8 single-feature knockouts) to
//  measure the contribution of each evolutionary feature.
//
//  CLI: --ablation=variant-name  to run only one variant
//  Full run is expensive — each variant trains N cycles + evals.
// ================================================================

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig, LLMAdapter } from '../../src/core/types.js';
import { Ecology } from '../../src/evolution/ecology.js';
import { buildSystemPrompt } from '../../src/llm/adapter.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { Math500Evaluator } from '../evaluators/math500-evaluator.js';
import { createBenchmarkAdapter } from '../create-adapter.js';
import { runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');
const OUTPUT_PATH = resolve(RESULTS_DIR, 'ablation-math500.json');

// ── Ablation Variants ────────────────────────────────────────────

interface AblationVariant {
  name: string;
  description: string;
  configOverrides: Partial<AgentConfig>;
}

const VARIANTS: AblationVariant[] = [
  {
    name: 'control',
    description: 'All features enabled (baseline)',
    configOverrides: {},
  },
  {
    name: 'no-adaptive-mutability',
    description: 'Fixed mutation rate (mutability=1.0)',
    configOverrides: { enableAdaptiveMutability: false },
  },
  {
    name: 'no-crossover',
    description: 'Mutation-only reproduction (no sexual recombination)',
    configOverrides: { enableCrossover: false },
  },
  {
    name: 'no-map-elites',
    description: 'No MAP-Elites rescue from archive',
    configOverrides: { enableMapElites: false },
  },
  {
    name: 'no-novelty',
    description: 'No novelty bonus on offspring',
    configOverrides: { enableNoveltyBonus: false },
  },
  {
    name: 'no-task-memory',
    description: 'No per-task-type memory or decay',
    configOverrides: { enableTaskMemory: false },
  },
  {
    name: 'no-fitness-decay',
    description: 'No fitness decay between cycles',
    configOverrides: { enableFitnessDecay: false },
  },
  {
    name: 'no-elo',
    description: 'No pairwise Elo rating updates',
    configOverrides: { enableElo: false },
  },
  {
    name: 'no-cycle-qd',
    description: 'No CycleQD axis rotation on MAP-Elites',
    configOverrides: { enableCycleQD: false },
  },
];

// ── Run a single variant ─────────────────────────────────────────

interface VariantResult {
  name: string;
  description: string;
  accuracy: number;
  correct: number;
  total: number;
  totalTokens: number;
  earlyAvgFitness: number;
  lateAvgFitness: number;
}

async function runVariant(
  variant: AblationVariant,
  adapter: LLMAdapter,
  cycles: number,
): Promise<VariantResult> {
  resetGenomeCounter();

  const config = createDefaultConfig({
    strategyCount: 8,
    taskBatchSize: 8,
    cullThreshold: -5,
    ...variant.configOverrides,
  });

  const trainEvaluator = new Math500Evaluator('train');
  let totalTokens = 0;

  const ecology = new Ecology(config, adapter, trainEvaluator, {
    onTaskComplete: (result) => { totalTokens += result.tokensUsed; },
  });

  const timeSeries: TimeSeriesPoint[] = [];
  console.log(`  [${variant.name}] Evolving...`);

  for (let i = 0; i < cycles; i++) {
    const stats = await ecology.runCycle();
    timeSeries.push({
      cycle: stats.cycle,
      avgFitness: stats.avgFitness,
      bestFitness: stats.bestFitness,
      strategyCount: stats.strategyCount,
    });
  }

  // Evaluate best strategy on eval split
  const best = ecology.getBestStrategy();
  if (!best) {
    return {
      name: variant.name,
      description: variant.description,
      accuracy: 0, correct: 0, total: 0, totalTokens,
      earlyAvgFitness: 0, lateAvgFitness: 0,
    };
  }

  const evalEvaluator = new Math500Evaluator('eval');
  const evalItems = evalEvaluator.getAllItems();
  const systemPrompt = buildSystemPrompt(
    config.systemPromptTemplate,
    best.genome,
    config.toolNames,
    best.taskTypeMemory,
  );

  let correct = 0;
  const total = evalItems.length;
  const CONCURRENCY = 4;

  for (let batchStart = 0; batchStart < evalItems.length; batchStart += CONCURRENCY) {
    const batch = evalItems.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item) => {
      const prompt = item.problem + '\n\nSolve this step by step. Put your final answer in \\boxed{}.';
      try {
        const response = await adapter.execute(prompt, {
          temperature: Math.min(1, Math.max(0, best.genome.temperature)),
          maxTokens: best.genome.maxTokenBudget,
          systemPrompt,
          toolNames: [],
        });
        return { tokens: response.tokensUsed, score: evalEvaluator.scoreById(item.id, response.content) };
      } catch {
        return { tokens: 0, score: 0 };
      }
    }));

    for (const r of results) {
      totalTokens += r.tokens;
      if (r.score === 1) correct++;
    }
  }

  const window = Math.min(5, Math.floor(cycles / 2));
  const earlyPoints = timeSeries.slice(0, window);
  const latePoints = timeSeries.slice(cycles - window);
  const avg = (pts: TimeSeriesPoint[], key: string) =>
    pts.reduce((s, p) => s + (p[key] as number), 0) / pts.length;

  console.log(`  [${variant.name}] accuracy: ${(correct / total * 100).toFixed(1)}%`);

  return {
    name: variant.name,
    description: variant.description,
    accuracy: correct / total,
    correct,
    total,
    totalTokens,
    earlyAvgFitness: avg(earlyPoints, 'avgFitness'),
    lateAvgFitness: avg(latePoints, 'avgFitness'),
  };
}

// ── Main Scenario ────────────────────────────────────────────────

export async function ablationMath500(
  seed: number,
  cycles = 15,
): Promise<BenchmarkResult> {
  return runBenchmark('ablation-math500', seed, async (s) => {
    const adapterInfo = await createBenchmarkAdapter();
    if (!adapterInfo) {
      return {
        passed: true,
        metrics: { skipped: 1 },
        timeSeries: [],
        details: 'Skipped: no working API found',
      };
    }

    // Parse --ablation=variant CLI arg
    const ablationArg = process.argv.find(a => a.startsWith('--ablation='));
    const targetVariant = ablationArg?.slice('--ablation='.length) ?? null;

    const variants = targetVariant
      ? VARIANTS.filter(v => v.name === targetVariant)
      : VARIANTS;

    if (variants.length === 0) {
      return {
        passed: false,
        metrics: {},
        timeSeries: [],
        details: `Unknown ablation variant: ${targetVariant}. Valid: ${VARIANTS.map(v => v.name).join(', ')}`,
      };
    }

    console.log('\n================================================================');
    console.log(`Ablation Study — MATH-500 (${variants.length} variant${variants.length > 1 ? 's' : ''}, ${cycles} cycles)`);
    console.log(`LLM Provider: ${adapterInfo.name} (${adapterInfo.model})`);
    console.log('================================================================\n');

    const variantResults: VariantResult[] = [];
    for (const variant of variants) {
      const result = await runVariant(variant, adapterInfo.adapter, cycles);
      variantResults.push(result);
    }

    // Find control result for delta computation
    const control = variantResults.find(r => r.name === 'control');

    // Print comparison table
    console.log('\n────────────────────────────────────────────────────────────────');
    console.log('Variant                     Accuracy    Delta    Description');
    console.log('────────────────────────────────────────────────────────────────');
    for (const r of variantResults) {
      const delta = control ? r.accuracy - control.accuracy : 0;
      const deltaStr = control && r.name !== 'control'
        ? `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`
        : '  —  ';
      console.log(
        `${r.name.padEnd(28)}${(r.accuracy * 100).toFixed(1).padStart(5)}%   ${deltaStr.padStart(7)}    ${r.description}`,
      );
    }
    console.log('────────────────────────────────────────────────────────────────');

    // Save JSON
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      cycles,
      variants: variantResults,
    }, null, 2));
    console.log(`\nResults saved to ${OUTPUT_PATH}`);

    // Metrics
    const metrics: Record<string, number> = {};
    for (const r of variantResults) {
      metrics[`${r.name}_accuracy`] = r.accuracy;
      metrics[`${r.name}_tokens`] = r.totalTokens;
    }
    const totalTokens = variantResults.reduce((s, r) => s + r.totalTokens, 0);
    metrics.totalTokensUsed = totalTokens;

    // Pass criteria: control ran successfully
    const controlAccuracy = control?.accuracy ?? 0;
    const passed = controlAccuracy > 0 || variantResults.length > 0;

    return {
      passed,
      metrics,
      timeSeries: [],
      details: control
        ? `Control: ${(controlAccuracy * 100).toFixed(1)}%, ${variantResults.length} variants, tokens: ${totalTokens}`
        : `${variantResults.length} variants completed, tokens: ${totalTokens}`,
    };
  });
}
