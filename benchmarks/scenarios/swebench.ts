// ================================================================
//  Scenario: SWE-bench Verified — Living-Agent gold patch comparison
//
//  Phase A: Static baseline (fixed prompt, no evolution)
//  Phase B: Evolve ecology on 250 train issues, eval best strategy
//           on 250 eval issues
//  Phase C: Print comparison table, save results JSON + predictions
//
//  Pass criteria (OR, lenient — SWE-bench is very hard without repo):
//    - accuracy >= 5% (binary threshold)
//    - fitness improved (late > early)
//    - beats static baseline
// ================================================================

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LLMAdapter } from '../../src/core/types.js';
import { Ecology } from '../../src/evolution/ecology.js';
import { buildSystemPrompt } from '../../src/llm/adapter.js';
import { createDefaultConfig, createLocalConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { SwebenchEvaluator, buildSwebenchPrompt } from '../evaluators/swebench-evaluator.js';
import { createBenchmarkAdapter, isOllamaMode } from '../create-adapter.js';
import { runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';
import { BenchLogger } from '../bench-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');
const COMPARISON_PATH = resolve(RESULTS_DIR, 'swebench-comparison.json');
const PREDICTIONS_PATH = resolve(RESULTS_DIR, 'swebench-predictions.jsonl');

const PREVIOUS_NO_CONTEXT = { accuracy: 0.052 };

const SWE_SYSTEM_PROMPT = `You are a software engineering expert. Given a GitHub issue for a Python repository, you will receive:
- The issue description (problem_statement)
- The exact files that need to be modified (files_changed)
- Discussion context from the issue thread when available (hints_text)

Use all provided context to produce a minimal unified diff patch.
Output ONLY the diff with --- a/path, +++ b/path, and @@ hunk headers. No explanation.`;

// ── Phase A: Static Baseline (no evolution) ──────────────────────

interface StaticBaselineResult {
  accuracy: number;
  correct: number;
  total: number;
  totalTokens: number;
}

async function runStaticBaseline(
  adapter: LLMAdapter,
  evalEvaluator: SwebenchEvaluator,
  logger: BenchLogger,
  concurrency = 4,
): Promise<StaticBaselineResult> {
  const evalItems = evalEvaluator.getAllItems();
  const CONCURRENCY = concurrency;

  let correct = 0;
  let totalTokens = 0;
  const total = evalItems.length;

  for (let batchStart = 0; batchStart < evalItems.length; batchStart += CONCURRENCY) {
    const batch = evalItems.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item) => {
      const prompt = buildSwebenchPrompt(item);
      const t0 = performance.now();
      try {
        const response = await adapter.execute(prompt, {
          temperature: 0.3,
          maxTokens: 2000,
          systemPrompt: SWE_SYSTEM_PROMPT,
          toolNames: [],
        });
        const inferenceMs = performance.now() - t0;
        const score = evalEvaluator.scoreById(item.id, response.content);
        logger.log({
          phase: 'static',
          itemIndex: batchStart + batch.indexOf(item),
          itemTotal: total,
          itemId: item.id,
          score,
          tokensUsed: response.tokensUsed,
          inferenceMs,
          responseLength: response.content.length,
          genome: { temperature: 0.3, reasoningDepth: 0, maxTokenBudget: 2000 },
          responsePreview: response.content.slice(0, 200),
        });
        return {
          tokens: response.tokensUsed,
          score,
          instance_id: item.instance_id,
          model_patch: response.content,
        };
      } catch {
        logger.log({
          phase: 'static',
          itemIndex: batchStart + batch.indexOf(item),
          itemTotal: total,
          itemId: item.id,
          score: 0,
          tokensUsed: 0,
          inferenceMs: performance.now() - t0,
          responseLength: 0,
        });
        return { tokens: 0, score: 0, instance_id: item.instance_id, model_patch: '' };
      }
    }));

    for (const r of results) {
      totalTokens += r.tokens;
      if (r.score === 1) correct++;
    }

    const done = Math.min(batchStart + CONCURRENCY, total);
    if (done % 50 === 0 || done === total) {
      console.log(`    static [${done}/${total}] accuracy so far: ${correct}/${done} = ${(correct / done * 100).toFixed(1)}%`);
    }
  }

  return { accuracy: correct / total, correct, total, totalTokens };
}

// ── Phase B: Living-Agent Evolution + Eval ──────────────────────

interface LivingAgentResult {
  accuracy: number;
  correct: number;
  total: number;
  earlyAvgFitness: number;
  lateAvgFitness: number;
  totalTokens: number;
  timeSeries: TimeSeriesPoint[];
  predictions: Array<{ instance_id: string; model_patch: string }>;
}

async function runLivingAgent(
  seed: number,
  cycles: number,
  adapter: LLMAdapter,
  logger: BenchLogger,
): Promise<LivingAgentResult | null> {
  resetGenomeCounter();

  const local = isOllamaMode();
  const config = local
    ? createLocalConfig({ systemPromptTemplate: SWE_SYSTEM_PROMPT })
    : createDefaultConfig({ strategyCount: 8, taskBatchSize: 8, cullThreshold: -5, systemPromptTemplate: SWE_SYSTEM_PROMPT });

  // Preflight — soft skip if API not reachable
  const preflight = await adapter.execute('Reply with just "ok"', {
    temperature: 0, maxTokens: 16,
    systemPrompt: 'Reply with exactly "ok"', toolNames: [],
  });
  if (preflight.tokensUsed === 0) {
    return null;
  }

  // ── Evolve on train split ─────────────────────────────────────
  const trainEvaluator = new SwebenchEvaluator('train');
  let totalTokens = 0;

  const ecology = new Ecology(config, adapter, trainEvaluator, {
    onTaskComplete: (result) => { totalTokens += result.tokensUsed; },
  });

  const timeSeries: TimeSeriesPoint[] = [];
  console.log('  [Living-Agent] Evolving on train split...');

  for (let i = 0; i < cycles; i++) {
    const cycleStart = performance.now();
    const stats = await ecology.runCycle();
    const cycleMs = performance.now() - cycleStart;
    timeSeries.push({
      cycle: stats.cycle,
      avgFitness: stats.avgFitness,
      bestFitness: stats.bestFitness,
      strategyCount: stats.strategyCount,
    });
    logger.logCycle(i + 1, cycles, {
      avgFitness: stats.avgFitness,
      bestFitness: stats.bestFitness,
      strategyCount: stats.strategyCount,
      elapsedMs: cycleMs,
    });
    if ((i + 1) % 5 === 0 || i === cycles - 1) {
      console.log(`    cycle ${i + 1}/${cycles}: avg=${stats.avgFitness.toFixed(3)} best=${stats.bestFitness.toFixed(3)}`);
    }
  }

  // ── Evaluate best strategy on eval split ──────────────────────
  const best = ecology.getBestStrategy();
  if (!best) {
    throw new Error('No strategies survived evolution');
  }

  console.log('  [Living-Agent] Evaluating best strategy on eval split...');
  const evalEvaluator = new SwebenchEvaluator('eval');
  const evalItems = evalEvaluator.getAllItems();

  const systemPrompt = buildSystemPrompt(
    config.systemPromptTemplate,
    best.genome,
    config.toolNames,
    best.taskTypeMemory,
  );

  let correct = 0;
  const total = evalItems.length;
  const CONCURRENCY = config.concurrency ?? 4;
  const predictions: Array<{ instance_id: string; model_patch: string }> = [];

  for (let batchStart = 0; batchStart < evalItems.length; batchStart += CONCURRENCY) {
    const batch = evalItems.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item) => {
      const prompt = buildSwebenchPrompt(item);
      const t0 = performance.now();
      try {
        const response = await adapter.execute(prompt, {
          temperature: Math.min(1, Math.max(0, best.genome.temperature)),
          maxTokens: best.genome.maxTokenBudget,
          systemPrompt,
          toolNames: [],
        });
        const inferenceMs = performance.now() - t0;
        const score = evalEvaluator.scoreById(item.id, response.content);
        logger.log({
          phase: 'evolution-eval',
          itemIndex: batchStart + batch.indexOf(item),
          itemTotal: total,
          itemId: item.id,
          strategyId: best.genome.id,
          genome: {
            temperature: best.genome.temperature,
            reasoningDepth: best.genome.reasoningDepth,
            maxTokenBudget: best.genome.maxTokenBudget,
            habitatPref: best.genome.habitatPref,
            mutability: best.genome.mutability,
          },
          score,
          tokensUsed: response.tokensUsed,
          inferenceMs,
          responseLength: response.content.length,
          responsePreview: response.content.slice(0, 200),
        });
        return {
          tokens: response.tokensUsed,
          score,
          instance_id: item.instance_id,
          model_patch: response.content,
        };
      } catch {
        logger.log({
          phase: 'evolution-eval',
          itemIndex: batchStart + batch.indexOf(item),
          itemTotal: total,
          itemId: item.id,
          strategyId: best.genome.id,
          score: 0,
          tokensUsed: 0,
          inferenceMs: performance.now() - t0,
          responseLength: 0,
        });
        return { tokens: 0, score: 0, instance_id: item.instance_id, model_patch: '' };
      }
    }));

    for (const r of results) {
      totalTokens += r.tokens;
      if (r.score === 1) correct++;
      predictions.push({ instance_id: r.instance_id, model_patch: r.model_patch });
    }

    const done = Math.min(batchStart + CONCURRENCY, total);
    if (done % 50 === 0 || done === total) {
      console.log(`    eval [${done}/${total}] accuracy so far: ${correct}/${done} = ${(correct / done * 100).toFixed(1)}%`);
    }
  }

  const window = Math.min(5, Math.floor(cycles / 2));
  const earlyPoints = timeSeries.slice(0, window);
  const latePoints = timeSeries.slice(cycles - window);
  const avg = (pts: TimeSeriesPoint[], key: string) =>
    pts.reduce((s, p) => s + p[key], 0) / pts.length;

  return {
    accuracy: correct / total,
    correct,
    total,
    earlyAvgFitness: avg(earlyPoints, 'avgFitness'),
    lateAvgFitness: avg(latePoints, 'avgFitness'),
    totalTokens,
    timeSeries,
    predictions,
  };
}

// ── Main Scenario ───────────────────────────────────────────────

export async function swebench(
  seed: number,
  cycles = 10,
): Promise<BenchmarkResult> {
  return runBenchmark('swebench', seed, async (s) => {
    const adapterInfo = await createBenchmarkAdapter();
    if (!adapterInfo) {
      return {
        passed: true,
        metrics: { skipped: 1 },
        timeSeries: [],
        details: 'Skipped: no working API found (tried all available keys)',
      };
    }

    console.log('\n================================================================');
    console.log('SWE-bench Verified — Living-Agent gold patch comparison (n=250)');
    console.log(`LLM Provider: ${adapterInfo.name} (${adapterInfo.model})`);
    console.log('================================================================\n');

    const logger = new BenchLogger('swebench');
    console.log(`Detailed logs: ${logger.getLogPath()}\n`);

    const concurrency = isOllamaMode() ? 2 : 4;

    // ── Phase A: Static Baseline ───────────────────────────────
    console.log(`Phase A: Static baseline (no evolution, concurrency=${concurrency})`);
    const staticEvalEvaluator = new SwebenchEvaluator('eval');
    const staticResult = await runStaticBaseline(adapterInfo.adapter, staticEvalEvaluator, logger, concurrency);
    console.log(`  Static accuracy:    ${(staticResult.accuracy * 100).toFixed(1)}%`);

    // ── Phase B: Living-Agent ─────────────────────────────────────
    console.log('\nPhase B: Living-Agent evolution + eval');
    const la = await runLivingAgent(s, cycles, adapterInfo.adapter, logger);

    if (!la) {
      return {
        passed: true,
        metrics: { totalTokensUsed: 0, skipped: 1 },
        timeSeries: [],
        details: 'Skipped: API not reachable (rate limited or unavailable)',
      };
    }

    console.log(`  Evolved accuracy:   ${(la.accuracy * 100).toFixed(1)}%`);

    // ── Phase C: Comparison ─────────────────────────────────────
    const deltaVsNoContext = la.accuracy - PREVIOUS_NO_CONTEXT.accuracy;
    const deltaVsStatic = la.accuracy - staticResult.accuracy;

    console.log('\n────────────────────────────────────────────────────────────────');
    console.log('Framework                       Accuracy   Method');
    console.log('────────────────────────────────────────────────────────────────');
    console.log(`No-context static (previous)    ${(PREVIOUS_NO_CONTEXT.accuracy * 100).toFixed(1).padStart(5)}%     files+hints blind, temp=0.3`);
    console.log(`With-context static (this run)  ${(staticResult.accuracy * 100).toFixed(1).padStart(5)}%     files+hints enriched, temp=0.3`);
    console.log(`With-context evolved (this run) ${(la.accuracy * 100).toFixed(1).padStart(5)}%     ${cycles} evolution cycles on 250 train`);
    const sign = deltaVsStatic >= 0 ? '+' : '';
    console.log(`                                ${sign}${(deltaVsStatic * 100).toFixed(1).padStart(4)}pp    Evolution delta over static`);
    const signNc = deltaVsNoContext >= 0 ? '+' : '';
    console.log(`                                ${signNc}${(deltaVsNoContext * 100).toFixed(1).padStart(4)}pp    Delta vs no-context`);
    console.log('────────────────────────────────────────────────────────────────');

    // Save comparison JSON
    mkdirSync(RESULTS_DIR, { recursive: true });
    const comparison = {
      timestamp: new Date().toISOString(),
      evalSize: la.total,
      previousNoContextAccuracy: PREVIOUS_NO_CONTEXT.accuracy,
      staticBaselineAccuracy: staticResult.accuracy,
      staticBaselineTokens: staticResult.totalTokens,
      livingAgentAccuracy: la.accuracy,
      livingAgentEvolutionCycles: cycles,
      livingAgentTotalTokens: la.totalTokens,
      evolutionDelta: deltaVsStatic,
      deltaVsNoContext,
    };
    writeFileSync(COMPARISON_PATH, JSON.stringify(comparison, null, 2));
    console.log(`\nResults saved to ${COMPARISON_PATH}`);

    // Save predictions JSONL (for future sb-cli submission)
    const predictionsLines = la.predictions
      .map(p => JSON.stringify({ instance_id: p.instance_id, model_patch: p.model_patch, model_name_or_path: 'living-agent' }))
      .join('\n');
    writeFileSync(PREDICTIONS_PATH, predictionsLines + '\n');
    console.log(`Predictions saved to ${PREDICTIONS_PATH}`);

    logger.logSummary({
      staticBaselineAccuracy: staticResult.accuracy,
      livingAgentAccuracy: la.accuracy,
      evolutionDelta: deltaVsStatic,
      deltaVsNoContext,
      totalTokens: la.totalTokens,
      staticTokens: staticResult.totalTokens,
      evolutionCycles: cycles,
      bestStrategyId: best?.genome.id,
      bestGenome: best ? {
        temperature: best.genome.temperature,
        reasoningDepth: best.genome.reasoningDepth,
        maxTokenBudget: best.genome.maxTokenBudget,
      } : null,
    });
    console.log(`Detailed logs saved to ${logger.getLogPath()}`);

    // ── Pass criteria (OR, lenient) ──────────────────────────────
    const fitnessImproved = la.lateAvgFitness > la.earlyAvgFitness;
    const accuracyThreshold = la.accuracy >= 0.05;
    const beatsStatic = la.accuracy > staticResult.accuracy;
    const passed = accuracyThreshold || fitnessImproved || beatsStatic;

    const metrics: Record<string, number> = {
      previousNoContextAccuracy: PREVIOUS_NO_CONTEXT.accuracy,
      livingAgentAccuracy: la.accuracy,
      livingAgentCorrect: la.correct,
      earlyAvgFitness: la.earlyAvgFitness,
      lateAvgFitness: la.lateAvgFitness,
      totalTokensUsed: la.totalTokens,
      staticBaselineAccuracy: staticResult.accuracy,
      staticBaselineCorrect: staticResult.correct,
      staticBaselineTokens: staticResult.totalTokens,
      evolutionDelta: deltaVsStatic,
      deltaVsNoContext,
    };

    const staticInfo = ` vs static ${(staticResult.accuracy * 100).toFixed(1)}% (${beatsStatic ? '+' : ''}${((la.accuracy - staticResult.accuracy) * 100).toFixed(1)}pp)`;

    return {
      passed,
      metrics,
      timeSeries: la.timeSeries,
      details: passed
        ? `Living-Agent ${(la.accuracy * 100).toFixed(1)}%${staticInfo}` +
          `, fitness: ${la.earlyAvgFitness.toFixed(3)} -> ${la.lateAvgFitness.toFixed(3)}, tokens: ${la.totalTokens}`
        : `Living-Agent accuracy too low: ${(la.accuracy * 100).toFixed(1)}%${staticInfo}, fitness: ${la.earlyAvgFitness.toFixed(3)} -> ${la.lateAvgFitness.toFixed(3)}`,
    };
  });
}
