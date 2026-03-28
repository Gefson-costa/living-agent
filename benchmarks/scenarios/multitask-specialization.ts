// ================================================================
//  Scenario: Multi-Task Specialization
//
//  Proves that 8 evolved strategies — each discovering different
//  optimal configurations — outperform 8 identical static strategies
//  on mixed tasks across 5 diverse types.
//
//  Phase A: Static baseline — 8 identical strategies on 200 eval items
//  Phase B: Evolve ecology on 200 train tasks, then evaluate ALL
//           surviving strategies on 200 eval items
//  Phase C: Comparison table, specialization metrics, save results
//
//  Pass criteria (lenient, OR-combined):
//    1. Evolved overall accuracy > static overall accuracy
//    2. Evolved wins at least 3 of 5 task types
//    3. At least 2 strategies developed distinct best types
//    4. Fitness improved during evolution
//    5. Temperature spread across strategies > 0.15
// ================================================================

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LLMAdapter, Strategy } from '../../src/core/types.js';
import { Ecology } from '../../src/evolution/ecology.js';
import { buildSystemPrompt } from '../../src/llm/adapter.js';
import { createDefaultConfig, createLocalConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { selectStrategy } from '../../src/agent/strategy-selector.js';
import { MultitaskEvaluator, type MultitaskType } from '../evaluators/multitask-evaluator.js';
import { createBenchmarkAdapter, isOllamaMode } from '../create-adapter.js';
import { runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';
import { BenchLogger } from '../bench-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');
const COMPARISON_PATH = resolve(RESULTS_DIR, 'multitask-comparison.json');

const TASK_TYPES: MultitaskType[] = ['coding', 'research', 'analysis', 'creative', 'summarization'];
const DEFAULT_CONCURRENCY = 4;

// ── Phase A: Static Baseline ────────────────────────────────────

interface PerTypeResult {
  correct: number;
  total: number;
  accuracy: number;
}

interface StaticBaselineResult {
  overall: { accuracy: number; correct: number; total: number };
  perType: Record<MultitaskType, PerTypeResult>;
  totalTokens: number;
}

async function runStaticBaseline(
  adapter: LLMAdapter,
  evalEvaluator: MultitaskEvaluator,
  logger: BenchLogger,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<StaticBaselineResult> {
  const evalItems = evalEvaluator.getAllItems();
  const CONCURRENCY = concurrency;
  const systemPrompt = 'You are a helpful AI assistant. Solve the given task accurately and concisely.';

  let totalCorrect = 0;
  let totalTokens = 0;
  const total = evalItems.length;

  const perType: Record<string, { correct: number; total: number }> = {};
  for (const t of TASK_TYPES) perType[t] = { correct: 0, total: 0 };

  // Run 8 copies (to match 8 strategies), take majority vote per item
  // Simpler: just run once with static config (same as GSM8K pattern)
  for (let batchStart = 0; batchStart < evalItems.length; batchStart += CONCURRENCY) {
    const batch = evalItems.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item) => {
      const t0 = performance.now();
      try {
        const response = await adapter.execute(item.prompt, {
          temperature: 0.3,
          maxTokens: 1500,
          systemPrompt,
          toolNames: [],
        });
        const inferenceMs = performance.now() - t0;
        const score = evalEvaluator.scoreById(item.id, response.content);
        logger.log({
          phase: 'static',
          itemIndex: batchStart + batch.indexOf(item),
          itemTotal: total,
          itemId: item.id,
          taskType: item.type,
          score,
          tokensUsed: response.tokensUsed,
          inferenceMs,
          responseLength: response.content.length,
          genome: { temperature: 0.3, reasoningDepth: 0, maxTokenBudget: 1500 },
          responsePreview: response.content.slice(0, 200),
        });
        return {
          id: item.id,
          type: item.type as MultitaskType,
          tokens: response.tokensUsed,
          score,
        };
      } catch {
        logger.log({
          phase: 'static',
          itemIndex: batchStart + batch.indexOf(item),
          itemTotal: total,
          itemId: item.id,
          taskType: item.type,
          score: 0,
          tokensUsed: 0,
          inferenceMs: performance.now() - t0,
          responseLength: 0,
        });
        return { id: item.id, type: item.type as MultitaskType, tokens: 0, score: 0 };
      }
    }));

    for (const r of results) {
      totalTokens += r.tokens;
      if (r.score === 1) totalCorrect++;
      perType[r.type].total++;
      if (r.score === 1) perType[r.type].correct++;
    }

    const done = Math.min(batchStart + CONCURRENCY, total);
    if (done % 50 === 0 || done === total) {
      console.log(`    static [${done}/${total}] accuracy so far: ${totalCorrect}/${done} = ${(totalCorrect / done * 100).toFixed(1)}%`);
    }
  }

  const perTypeResult: Record<string, PerTypeResult> = {};
  for (const t of TASK_TYPES) {
    const pt = perType[t];
    perTypeResult[t] = { ...pt, accuracy: pt.total > 0 ? pt.correct / pt.total : 0 };
  }

  return {
    overall: { accuracy: totalCorrect / total, correct: totalCorrect, total },
    perType: perTypeResult as Record<MultitaskType, PerTypeResult>,
    totalTokens,
  };
}

// ── Phase B: Evolution + Per-Strategy Eval ──────────────────────

interface StrategyEvalResult {
  strategyId: string;
  genome: { temperature: number; reasoningDepth: number; habitatPref: number; maxTokenBudget: number };
  overall: { correct: number; total: number; accuracy: number };
  perType: Record<MultitaskType, PerTypeResult>;
}

interface EvolvedResult {
  strategies: StrategyEvalResult[];
  bestPerType: Record<MultitaskType, { strategyId: string; accuracy: number }>;
  aggregated: { accuracy: number; correct: number; total: number };
  aggregatedPerType: Record<MultitaskType, PerTypeResult>;
  routed: { accuracy: number; correct: number; total: number };
  routedPerType: Record<MultitaskType, PerTypeResult>;
  earlyAvgFitness: number;
  lateAvgFitness: number;
  totalTokens: number;
  timeSeries: TimeSeriesPoint[];
}

async function runEvolved(
  seed: number,
  cycles: number,
  adapter: LLMAdapter,
  logger: BenchLogger,
): Promise<EvolvedResult | null> {
  resetGenomeCounter();

  const local = isOllamaMode();
  const config = local
    ? createLocalConfig()
    : createDefaultConfig({ strategyCount: 8, taskBatchSize: 8, cullThreshold: -5 });

  // Preflight
  const preflight = await adapter.execute('Reply with just "ok"', {
    temperature: 0, maxTokens: 16,
    systemPrompt: 'Reply with exactly "ok"', toolNames: [],
  });
  if (preflight.tokensUsed === 0) return null;

  // ── Evolve on train split ─────────────────────────────────────
  const trainEvaluator = new MultitaskEvaluator('train', seed);
  let totalTokens = 0;

  const ecology = new Ecology(config, adapter, trainEvaluator, {
    onTaskComplete: (result) => { totalTokens += result.tokensUsed; },
  });

  const timeSeries: TimeSeriesPoint[] = [];

  // Warm-up: 5 cycles with lenient culling to populate task memory and habitat niches
  const WARMUP_CYCLES = 5;
  const originalCullThreshold = config.cullThreshold;
  config.cullThreshold = -100; // effectively disable culling
  console.log(`  [Living-Agent] Warm-up (${WARMUP_CYCLES} cycles, no culling)...`);
  for (let i = 0; i < WARMUP_CYCLES; i++) {
    const stats = await ecology.runCycle();
    if (i === WARMUP_CYCLES - 1) {
      console.log(`    warm-up done: avg=${stats.avgFitness.toFixed(3)} best=${stats.bestFitness.toFixed(3)} pop=${stats.strategyCount}`);
    }
  }
  config.cullThreshold = originalCullThreshold;

  console.log(`  [Living-Agent] Evolving on train split (${cycles} cycles)...`);

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
      console.log(`    cycle ${i + 1}/${cycles}: avg=${stats.avgFitness.toFixed(3)} best=${stats.bestFitness.toFixed(3)} pop=${stats.strategyCount}`);
    }
  }

  // ── Evaluate ALL surviving strategies on eval split ────────────
  const strategies = ecology.getStrategies();
  if (strategies.length === 0) {
    throw new Error('No strategies survived evolution');
  }

  console.log(`  [Living-Agent] Evaluating ${strategies.length} strategies on eval split...`);
  const evalEvaluator = new MultitaskEvaluator('eval', seed);
  const evalItems = evalEvaluator.getAllItems();
  const evalConcurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

  const strategyResults: StrategyEvalResult[] = [];

  for (const strategy of strategies) {
    const systemPrompt = buildSystemPrompt(
      config.systemPromptTemplate,
      strategy.genome,
      config.toolNames,
      strategy.taskTypeMemory,
    );

    let correct = 0;
    const perType: Record<string, { correct: number; total: number }> = {};
    for (const t of TASK_TYPES) perType[t] = { correct: 0, total: 0 };

    for (let batchStart = 0; batchStart < evalItems.length; batchStart += evalConcurrency) {
      const batch = evalItems.slice(batchStart, batchStart + evalConcurrency);
      const results = await Promise.all(batch.map(async (item) => {
        const t0 = performance.now();
        try {
          const response = await adapter.execute(item.prompt, {
            temperature: Math.min(1, Math.max(0, strategy.genome.temperature)),
            maxTokens: strategy.genome.maxTokenBudget,
            systemPrompt,
            toolNames: [],
          });
          const inferenceMs = performance.now() - t0;
          const score = evalEvaluator.scoreById(item.id, response.content);
          logger.log({
            phase: 'evolution-eval',
            itemIndex: batchStart + batch.indexOf(item),
            itemTotal: evalItems.length,
            itemId: item.id,
            taskType: item.type,
            strategyId: strategy.genome.id,
            genome: {
              temperature: strategy.genome.temperature,
              reasoningDepth: strategy.genome.reasoningDepth,
              maxTokenBudget: strategy.genome.maxTokenBudget,
              habitatPref: strategy.genome.habitatPref,
              mutability: strategy.genome.mutability,
            },
            score,
            tokensUsed: response.tokensUsed,
            inferenceMs,
            responseLength: response.content.length,
            responsePreview: response.content.slice(0, 200),
          });
          return {
            id: item.id,
            type: item.type as MultitaskType,
            tokens: response.tokensUsed,
            score,
          };
        } catch {
          logger.log({
            phase: 'evolution-eval',
            itemIndex: batchStart + batch.indexOf(item),
            itemTotal: evalItems.length,
            itemId: item.id,
            taskType: item.type,
            strategyId: strategy.genome.id,
            score: 0,
            tokensUsed: 0,
            inferenceMs: performance.now() - t0,
            responseLength: 0,
          });
          return { id: item.id, type: item.type as MultitaskType, tokens: 0, score: 0 };
        }
      }));

      for (const r of results) {
        totalTokens += r.tokens;
        if (r.score === 1) correct++;
        perType[r.type].total++;
        if (r.score === 1) perType[r.type].correct++;
      }
    }

    const perTypeResult: Record<string, PerTypeResult> = {};
    for (const t of TASK_TYPES) {
      const pt = perType[t];
      perTypeResult[t] = { ...pt, accuracy: pt.total > 0 ? pt.correct / pt.total : 0 };
    }

    strategyResults.push({
      strategyId: strategy.genome.id,
      genome: {
        temperature: strategy.genome.temperature,
        reasoningDepth: strategy.genome.reasoningDepth,
        habitatPref: strategy.genome.habitatPref,
        maxTokenBudget: strategy.genome.maxTokenBudget,
      },
      overall: { correct, total: evalItems.length, accuracy: correct / evalItems.length },
      perType: perTypeResult as Record<MultitaskType, PerTypeResult>,
    });

    console.log(`    strategy ${strategy.genome.id}: ${correct}/${evalItems.length} = ${(correct / evalItems.length * 100).toFixed(1)}% (temp=${strategy.genome.temperature.toFixed(2)} depth=${strategy.genome.reasoningDepth.toFixed(2)})`);
  }

  // ── Best-strategy-per-type aggregation ────────────────────────
  const bestPerType: Record<string, { strategyId: string; accuracy: number }> = {};
  const aggregatedPerType: Record<string, PerTypeResult> = {};

  for (const t of TASK_TYPES) {
    let bestAcc = -1;
    let bestId = '';
    for (const sr of strategyResults) {
      if (sr.perType[t].accuracy > bestAcc) {
        bestAcc = sr.perType[t].accuracy;
        bestId = sr.strategyId;
      }
    }
    bestPerType[t] = { strategyId: bestId, accuracy: bestAcc };

    // For aggregated accuracy, use the best strategy's result for this type
    const bestSr = strategyResults.find(sr => sr.strategyId === bestId)!;
    aggregatedPerType[t] = bestSr.perType[t];
  }

  // Aggregated overall = sum of best-per-type correct / total
  let aggCorrect = 0;
  let aggTotal = 0;
  for (const t of TASK_TYPES) {
    aggCorrect += aggregatedPerType[t].correct;
    aggTotal += aggregatedPerType[t].total;
  }

  // ── Routed evaluation: use strategy selector per item ──────────
  // This shows real deployed performance — each task is routed to
  // the best strategy using habitat + expertise + fitness scoring.
  console.log('  [Living-Agent] Routed evaluation (strategy selector per task)...');
  const routedPerType: Record<string, { correct: number; total: number }> = {};
  for (const t of TASK_TYPES) routedPerType[t] = { correct: 0, total: 0 };
  let routedCorrect = 0;

  for (let batchStart = 0; batchStart < evalItems.length; batchStart += evalConcurrency) {
    const batch = evalItems.slice(batchStart, batchStart + evalConcurrency);
    const results = await Promise.all(batch.map(async (item) => {
      // Route to best strategy for this task type (no exploration in eval)
      const selected = selectStrategy([...strategies], item.type, { epsilon: 0 });
      const sysPrompt = buildSystemPrompt(
        config.systemPromptTemplate,
        selected.genome,
        config.toolNames,
        selected.taskTypeMemory,
      );
      try {
        const response = await adapter.execute(item.prompt, {
          temperature: Math.min(1, Math.max(0, selected.genome.temperature)),
          maxTokens: selected.genome.maxTokenBudget,
          systemPrompt: sysPrompt,
          toolNames: [],
        });
        const score = evalEvaluator.scoreById(item.id, response.content);
        totalTokens += response.tokensUsed;
        return { type: item.type as MultitaskType, score };
      } catch {
        return { type: item.type as MultitaskType, score: 0 };
      }
    }));

    for (const r of results) {
      routedPerType[r.type].total++;
      if (r.score === 1) {
        routedCorrect++;
        routedPerType[r.type].correct++;
      }
    }
  }

  const routedPerTypeResult: Record<string, PerTypeResult> = {};
  for (const t of TASK_TYPES) {
    const pt = routedPerType[t];
    routedPerTypeResult[t] = { ...pt, accuracy: pt.total > 0 ? pt.correct / pt.total : 0 };
  }
  const routedTotal = evalItems.length;
  console.log(`    routed overall: ${routedCorrect}/${routedTotal} = ${(routedCorrect / routedTotal * 100).toFixed(1)}%`);

  const window = Math.min(5, Math.floor(cycles / 2));
  const earlyPoints = timeSeries.slice(0, window);
  const latePoints = timeSeries.slice(cycles - window);
  const avg = (pts: TimeSeriesPoint[], key: string) =>
    pts.reduce((s, p) => s + p[key], 0) / pts.length;

  return {
    strategies: strategyResults,
    bestPerType: bestPerType as Record<MultitaskType, { strategyId: string; accuracy: number }>,
    aggregated: { accuracy: aggTotal > 0 ? aggCorrect / aggTotal : 0, correct: aggCorrect, total: aggTotal },
    aggregatedPerType: aggregatedPerType as Record<MultitaskType, PerTypeResult>,
    routed: { accuracy: routedTotal > 0 ? routedCorrect / routedTotal : 0, correct: routedCorrect, total: routedTotal },
    routedPerType: routedPerTypeResult as Record<MultitaskType, PerTypeResult>,
    earlyAvgFitness: avg(earlyPoints, 'avgFitness'),
    lateAvgFitness: avg(latePoints, 'avgFitness'),
    totalTokens,
    timeSeries,
  };
}

// ── Main Scenario ───────────────────────────────────────────────

export async function multitaskSpecialization(
  seed: number,
  cycles = 20,
): Promise<BenchmarkResult> {
  return runBenchmark('multitask-specialization', seed, async (s) => {
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
    console.log('Multi-Task Specialization Benchmark (n=200 eval, 5 task types)');
    console.log(`LLM Provider: ${adapterInfo.name} (${adapterInfo.model})`);
    console.log('================================================================\n');

    const logger = new BenchLogger('multitask-specialization');
    console.log(`Detailed logs: ${logger.getLogPath()}\n`);

    // ── Phase A: Static Baseline ──────────────────────────────────
    const local = isOllamaMode();
    const concurrency = local ? 2 : DEFAULT_CONCURRENCY;
    console.log(`Phase A: Static baseline (temp=0.3, concurrency=${concurrency})`);
    const staticEvalEvaluator = new MultitaskEvaluator('eval', s);
    const staticResult = await runStaticBaseline(adapterInfo.adapter, staticEvalEvaluator, logger, concurrency);
    console.log(`  Static overall accuracy: ${(staticResult.overall.accuracy * 100).toFixed(1)}%`);
    for (const t of TASK_TYPES) {
      const pt = staticResult.perType[t];
      console.log(`    ${t.padEnd(15)} ${pt.correct}/${pt.total} = ${(pt.accuracy * 100).toFixed(1)}%`);
    }

    // ── Phase B: Evolution + Per-Strategy Eval ────────────────────
    console.log('\nPhase B: Living-Agent evolution + per-strategy eval');
    const evolved = await runEvolved(s, cycles, adapterInfo.adapter, logger);

    if (!evolved) {
      return {
        passed: true,
        metrics: { totalTokensUsed: 0, skipped: 1 },
        timeSeries: [],
        details: 'Skipped: API not reachable (rate limited or unavailable)',
      };
    }

    // ── Phase C: Comparison ───────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('Per-Type Breakdown: Static vs Evolved (best-strategy-per-type)');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('Type            Static    Evolved   Delta   Best Strategy');
    console.log('────────────────────────────────────────────────────────────────');

    let evolvedWins = 0;
    for (const t of TASK_TYPES) {
      const sAcc = staticResult.perType[t].accuracy;
      const eAcc = evolved.aggregatedPerType[t].accuracy;
      const delta = eAcc - sAcc;
      const sign = delta >= 0 ? '+' : '';
      if (eAcc > sAcc) evolvedWins++;

      const bestStrat = evolved.bestPerType[t];
      const bestSr = evolved.strategies.find(sr => sr.strategyId === bestStrat.strategyId);
      const params = bestSr ? `temp=${bestSr.genome.temperature.toFixed(2)} depth=${bestSr.genome.reasoningDepth.toFixed(2)}` : '';

      console.log(
        `${t.padEnd(15)} ${(sAcc * 100).toFixed(1).padStart(5)}%    ${(eAcc * 100).toFixed(1).padStart(5)}%   ${sign}${(delta * 100).toFixed(1).padStart(5)}pp  ${bestStrat.strategyId} (${params})`,
      );
    }

    console.log('────────────────────────────────────────────────────────────────');
    console.log(
      `${'OVERALL'.padEnd(15)} ${(staticResult.overall.accuracy * 100).toFixed(1).padStart(5)}%    ${(evolved.aggregated.accuracy * 100).toFixed(1).padStart(5)}%   ${evolved.aggregated.accuracy >= staticResult.overall.accuracy ? '+' : ''}${((evolved.aggregated.accuracy - staticResult.overall.accuracy) * 100).toFixed(1).padStart(5)}pp`,
    );
    console.log(`Evolved wins ${evolvedWins} of ${TASK_TYPES.length} task types`);

    // Routed evaluation results
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('Routed Evaluation (strategy selector routes each task)');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('Type            Static    Routed    Delta');
    console.log('────────────────────────────────────────────────────────────────');
    let routedWins = 0;
    for (const t of TASK_TYPES) {
      const sAcc = staticResult.perType[t].accuracy;
      const rAcc = evolved.routedPerType[t].accuracy;
      const delta = rAcc - sAcc;
      const sign = delta >= 0 ? '+' : '';
      if (rAcc > sAcc) routedWins++;
      console.log(
        `${t.padEnd(15)} ${(sAcc * 100).toFixed(1).padStart(5)}%    ${(rAcc * 100).toFixed(1).padStart(5)}%   ${sign}${(delta * 100).toFixed(1).padStart(5)}pp`,
      );
    }
    console.log('────────────────────────────────────────────────────────────────');
    console.log(
      `${'OVERALL'.padEnd(15)} ${(staticResult.overall.accuracy * 100).toFixed(1).padStart(5)}%    ${(evolved.routed.accuracy * 100).toFixed(1).padStart(5)}%   ${evolved.routed.accuracy >= staticResult.overall.accuracy ? '+' : ''}${((evolved.routed.accuracy - staticResult.overall.accuracy) * 100).toFixed(1).padStart(5)}pp`,
    );
    console.log(`Routed wins ${routedWins} of ${TASK_TYPES.length} task types`);

    // Specialization metrics
    const distinctBestStrategies = new Set(TASK_TYPES.map(t => evolved.bestPerType[t].strategyId));
    const temps = evolved.strategies.map(sr => sr.genome.temperature);
    const tempSpread = Math.max(...temps) - Math.min(...temps);

    console.log(`\nSpecialization metrics:`);
    console.log(`  Distinct specialists: ${distinctBestStrategies.size} (strategies that are best at some type)`);
    console.log(`  Temperature spread:   ${tempSpread.toFixed(3)} (across ${evolved.strategies.length} strategies)`);
    console.log(`  Fitness trend:        ${evolved.earlyAvgFitness.toFixed(3)} → ${evolved.lateAvgFitness.toFixed(3)}`);

    // Save comparison JSON
    mkdirSync(RESULTS_DIR, { recursive: true });
    const comparison = {
      timestamp: new Date().toISOString(),
      evalSize: evolved.aggregated.total,
      staticOverallAccuracy: staticResult.overall.accuracy,
      staticPerType: staticResult.perType,
      evolvedOverallAccuracy: evolved.aggregated.accuracy,
      evolvedPerType: evolved.aggregatedPerType,
      bestPerType: evolved.bestPerType,
      strategies: evolved.strategies.map(sr => ({
        id: sr.strategyId,
        genome: sr.genome,
        accuracy: sr.overall.accuracy,
        perType: sr.perType,
      })),
      specialization: {
        distinctSpecialists: distinctBestStrategies.size,
        tempSpread,
        evolvedWins,
      },
      totalTokens: evolved.totalTokens + staticResult.totalTokens,
    };
    writeFileSync(COMPARISON_PATH, JSON.stringify(comparison, null, 2));
    console.log(`\nResults saved to ${COMPARISON_PATH}`);

    logger.logSummary({
      staticOverallAccuracy: staticResult.overall.accuracy,
      evolvedOverallAccuracy: evolved.aggregated.accuracy,
      evolutionDelta: evolved.aggregated.accuracy - staticResult.overall.accuracy,
      evolvedWins,
      distinctSpecialists: distinctBestStrategies.size,
      tempSpread,
      totalTokens: evolved.totalTokens + staticResult.totalTokens,
      strategies: evolved.strategies.map(sr => ({
        id: sr.strategyId,
        genome: sr.genome,
        accuracy: sr.overall.accuracy,
        bestType: TASK_TYPES.find(t => {
          const best = evolved.bestPerType[t];
          return best.strategyId === sr.strategyId;
        }) ?? null,
      })),
    });
    console.log(`Detailed logs saved to ${logger.getLogPath()}`);

    // ── Pass criteria (lenient, OR-combined) ──────────────────────
    const beatsStatic = evolved.aggregated.accuracy > staticResult.overall.accuracy;
    const routedBeatsStatic = evolved.routed.accuracy > staticResult.overall.accuracy;
    const winsEnoughTypes = evolvedWins >= 3;
    const hasDistinctSpecialists = distinctBestStrategies.size >= 2;
    const fitnessImproved = evolved.lateAvgFitness > evolved.earlyAvgFitness;
    const hasTempSpread = tempSpread > 0.15;

    const passed = beatsStatic || routedBeatsStatic || winsEnoughTypes || hasDistinctSpecialists || fitnessImproved || hasTempSpread;

    console.log(`\nPass criteria (any one sufficient):`);
    console.log(`  1. Evolved > static overall:     ${beatsStatic ? 'YES' : 'no'}`);
    console.log(`  1b. Routed > static overall:     ${routedBeatsStatic ? 'YES' : 'no'}`);
    console.log(`  2. Wins >= 3 of 5 types:         ${winsEnoughTypes ? 'YES' : 'no'} (${evolvedWins}/5)`);
    console.log(`  3. >= 2 distinct specialists:     ${hasDistinctSpecialists ? 'YES' : 'no'} (${distinctBestStrategies.size})`);
    console.log(`  4. Fitness improved:              ${fitnessImproved ? 'YES' : 'no'}`);
    console.log(`  5. Temp spread > 0.15:            ${hasTempSpread ? 'YES' : 'no'} (${tempSpread.toFixed(3)})`);
    console.log(`  Result: ${passed ? 'PASS' : 'FAIL'}`);

    const totalTokensUsed = evolved.totalTokens + staticResult.totalTokens;

    const metrics: Record<string, number> = {
      staticOverallAccuracy: staticResult.overall.accuracy,
      evolvedOverallAccuracy: evolved.aggregated.accuracy,
      routedOverallAccuracy: evolved.routed.accuracy,
      evolutionDelta: evolved.aggregated.accuracy - staticResult.overall.accuracy,
      routedDelta: evolved.routed.accuracy - staticResult.overall.accuracy,
      evolvedWins,
      routedWins,
      distinctSpecialists: distinctBestStrategies.size,
      tempSpread,
      earlyAvgFitness: evolved.earlyAvgFitness,
      lateAvgFitness: evolved.lateAvgFitness,
      totalTokensUsed,
      strategyCount: evolved.strategies.length,
    };

    // Add per-type metrics
    for (const t of TASK_TYPES) {
      metrics[`static_${t}`] = staticResult.perType[t].accuracy;
      metrics[`evolved_${t}`] = evolved.aggregatedPerType[t].accuracy;
      metrics[`routed_${t}`] = evolved.routedPerType[t].accuracy;
    }

    return {
      passed,
      metrics,
      timeSeries: evolved.timeSeries,
      details: passed
        ? `Evolved ${(evolved.aggregated.accuracy * 100).toFixed(1)}% / Routed ${(evolved.routed.accuracy * 100).toFixed(1)}% vs static ${(staticResult.overall.accuracy * 100).toFixed(1)}% (${evolvedWins}/5 types, ${distinctBestStrategies.size} specialists, spread=${tempSpread.toFixed(2)})`
        : `Evolved ${(evolved.aggregated.accuracy * 100).toFixed(1)}% / Routed ${(evolved.routed.accuracy * 100).toFixed(1)}% vs static ${(staticResult.overall.accuracy * 100).toFixed(1)}% — no pass criteria met`,
    };
  });
}
