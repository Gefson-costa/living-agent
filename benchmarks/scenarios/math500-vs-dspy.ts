// ================================================================
//  Scenario: MATH-500 — Living-Agent vs DSPy
//
//  Phase A: Run DSPy baselines (Python subprocess, 24h result cache)
//  Phase B: Evolve ecology on 250 train problems, eval best strategy
//           directly on 250 eval problems
//  Phase C: Print comparison table, save results JSON
//
//  Pass criteria: accuracy >= 30% OR within 10pp of DSPy zero-shot
//                 OR fitness improved during evolution
// ================================================================

import 'dotenv/config';
import { execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LLMAdapter } from '../../src/core/types.js';
import { Ecology } from '../../src/evolution/ecology.js';
import { buildSystemPrompt } from '../../src/llm/adapter.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { Math500Evaluator } from '../evaluators/math500-evaluator.js';
import { createBenchmarkAdapter, hasAnyApiKey } from '../create-adapter.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');
const DSPY_RESULTS_PATH = resolve(RESULTS_DIR, 'dspy-math500.json');
const DSPY_SCRIPT = resolve(__dirname, '..', 'dspy', 'math500_baseline.py');
const COMPARISON_PATH = resolve(RESULTS_DIR, 'math500-comparison.json');

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface DspyResults {
  zeroshot?: { accuracy: number; correct: number; total: number; duration_s?: number };
  bootstrap?: { accuracy: number; correct: number; total: number; error?: string; duration_s?: number };
}

// ── Phase A: DSPy Baselines ─────────────────────────────────────

function isDspyCacheValid(): boolean {
  if (!existsSync(DSPY_RESULTS_PATH)) return false;
  try {
    const stat = statSync(DSPY_RESULTS_PATH);
    return (Date.now() - stat.mtimeMs) < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function runDspyBaseline(): Promise<DspyResults> {
  // Check 24h cache
  if (isDspyCacheValid()) {
    console.log('  [DSPy] Using cached results (< 24h old)');
    return JSON.parse(readFileSync(DSPY_RESULTS_PATH, 'utf-8'));
  }

  // Pass all available API keys — Python script auto-detects the best one
  const hasKey = !!(process.env.DEEPSEEK_API_KEY || process.env.OPENROUTER_API_KEY || process.env.TOGETHER_API_KEY);
  if (!hasKey) {
    console.log('  [DSPy] Skipped: no API key set (DEEPSEEK_API_KEY, OPENROUTER_API_KEY, or TOGETHER_API_KEY)');
    return {};
  }

  // Check if dspy is installed
  try {
    await runPython(['-c', 'import dspy']);
  } catch {
    console.log('  [DSPy] Skipped: dspy not installed (pip install dspy>=2.6.0)');
    return {};
  }

  console.log('  [DSPy] Running baselines (this may take several minutes)...');
  mkdirSync(RESULTS_DIR, { recursive: true });

  try {
    await runPython([DSPY_SCRIPT]);
  } catch (err) {
    // Bootstrap may fail while zero-shot checkpoint was already saved
    console.log(`  [DSPy] Script exited with error (checking for partial results): ${err instanceof Error ? err.message.slice(0, 100) : ''}`);
  }

  if (existsSync(DSPY_RESULTS_PATH)) {
    return JSON.parse(readFileSync(DSPY_RESULTS_PATH, 'utf-8'));
  }
  return {};
}

function runPython(args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('python', args, {
      env: { ...process.env, ...extraEnv },
      timeout: 20 * 60 * 1000, // 20 min
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

// ── Phase A2: Static Baseline (no evolution) ────────────────────

interface StaticBaselineResult {
  accuracy: number;
  correct: number;
  total: number;
  totalTokens: number;
}

async function runStaticBaseline(
  adapter: LLMAdapter,
  evalEvaluator: Math500Evaluator,
): Promise<StaticBaselineResult> {
  const evalItems = evalEvaluator.getAllItems();
  const CONCURRENCY = 4;
  const systemPrompt = 'You are a math expert. Solve problems step by step, showing clear reasoning. Put your final answer in \\boxed{}.';

  let correct = 0;
  let totalTokens = 0;
  const total = evalItems.length;

  for (let batchStart = 0; batchStart < evalItems.length; batchStart += CONCURRENCY) {
    const batch = evalItems.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item) => {
      const prompt = item.problem + '\n\nSolve this step by step. Put your final answer in \\boxed{}.';
      try {
        const response = await adapter.execute(prompt, {
          temperature: 0.3,
          maxTokens: 1500,
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
}

async function runLivingAgent(
  seed: number,
  cycles: number,
  adapter: LLMAdapter,
): Promise<LivingAgentResult | null> {
  resetGenomeCounter();

  const config = createDefaultConfig({
    strategyCount: 8,
    taskBatchSize: 8,
    cullThreshold: -5,  // More lenient — MATH fuzzy scoring is sparser
  });

  // Preflight — soft skip if API not reachable
  const preflight = await adapter.execute('Reply with just "ok"', {
    temperature: 0, maxTokens: 16,
    systemPrompt: 'Reply with exactly "ok"', toolNames: [],
  });
  if (preflight.tokensUsed === 0) {
    return null;
  }

  // ── Evolve on train split ─────────────────────────────────────
  const trainEvaluator = new Math500Evaluator('train');
  let totalTokens = 0;

  const ecology = new Ecology(config, adapter, trainEvaluator, {
    onTaskComplete: (result) => { totalTokens += result.tokensUsed; },
  });

  const timeSeries: TimeSeriesPoint[] = [];
  console.log('  [Living-Agent] Evolving on train split...');

  for (let i = 0; i < cycles; i++) {
    const stats = await ecology.runCycle();
    timeSeries.push({
      cycle: stats.cycle,
      avgFitness: stats.avgFitness,
      bestFitness: stats.bestFitness,
      strategyCount: stats.strategyCount,
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

  // Process eval items in batches for speed
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
  };
}

// ── Main Scenario ───────────────────────────────────────────────

export async function math500VsDspy(
  seed: number,
  cycles = 20,
): Promise<BenchmarkResult> {
  return runBenchmark('math500-vs-dspy', seed, async (s) => {
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
    console.log('MATH-500 Benchmark — Living-Agent vs DSPy (n=250 eval problems)');
    console.log(`LLM Provider: ${adapterInfo.name} (${adapterInfo.model})`);
    console.log('================================================================\n');

    // ── Phase A: DSPy ─────────────────────────────────────────────
    console.log('Phase A: DSPy baselines');
    let dspy: DspyResults = {};
    try {
      dspy = await runDspyBaseline();
    } catch (err) {
      console.log(`  [DSPy] Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const dspyZeroshot = dspy.zeroshot?.accuracy ?? null;
    const dspyBootstrap = dspy.bootstrap?.accuracy ?? null;

    if (dspyZeroshot !== null) {
      console.log(`  Zero-shot CoT:      ${(dspyZeroshot * 100).toFixed(1)}%`);
    } else {
      console.log('  Zero-shot CoT:      (not available)');
    }
    if (dspyBootstrap !== null) {
      console.log(`  BootstrapFewShot:   ${(dspyBootstrap * 100).toFixed(1)}%`);
    } else {
      console.log('  BootstrapFewShot:   (not available)');
    }

    // ── Phase A2: Static Baseline ───────────────────────────────
    console.log('\nPhase A2: Static baseline (no evolution)');
    const staticEvalEvaluator = new Math500Evaluator('eval');
    const staticResult = await runStaticBaseline(adapterInfo.adapter, staticEvalEvaluator);
    console.log(`  Static accuracy:    ${(staticResult.accuracy * 100).toFixed(1)}%`);

    // ── Phase B: Living-Agent ─────────────────────────────────────
    console.log('\nPhase B: Living-Agent evolution + eval');
    const la = await runLivingAgent(s, cycles, adapterInfo.adapter);

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
    console.log('\n────────────────────────────────────────────────────────────────');
    console.log('Framework                 Accuracy   Method');
    console.log('────────────────────────────────────────────────────────────────');
    if (staticResult) {
      console.log(`Haiku static baseline     ${(staticResult.accuracy * 100).toFixed(1).padStart(5)}%     Fixed prompt, temp=0.3, no evolution`);
    }
    if (dspyZeroshot !== null) {
      console.log(`DSPy zero-shot CoT        ${(dspyZeroshot * 100).toFixed(1).padStart(5)}%     No optimization`);
    }
    if (dspyBootstrap !== null) {
      console.log(`DSPy BootstrapFewShot     ${(dspyBootstrap * 100).toFixed(1).padStart(5)}%     Compiled on 50 train examples`);
    }
    console.log(`Living-Agent (evolved)    ${(la.accuracy * 100).toFixed(1).padStart(5)}%     ${cycles} evolution cycles on 250 train`);
    if (staticResult) {
      const delta = la.accuracy - staticResult.accuracy;
      const sign = delta >= 0 ? '+' : '';
      console.log(`                          ${sign}${(delta * 100).toFixed(1).padStart(4)}pp    Evolution delta over static`);
    }
    console.log('────────────────────────────────────────────────────────────────');

    // Save comparison JSON
    mkdirSync(RESULTS_DIR, { recursive: true });
    const comparison = {
      timestamp: new Date().toISOString(),
      evalSize: la.total,
      staticBaselineAccuracy: staticResult?.accuracy ?? null,
      staticBaselineTokens: staticResult?.totalTokens ?? null,
      dspyZeroshotAccuracy: dspyZeroshot,
      dspyBootstrapAccuracy: dspyBootstrap,
      livingAgentAccuracy: la.accuracy,
      livingAgentEvolutionCycles: cycles,
      livingAgentTotalTokens: la.totalTokens,
      evolutionDelta: staticResult ? la.accuracy - staticResult.accuracy : null,
    };
    writeFileSync(COMPARISON_PATH, JSON.stringify(comparison, null, 2));
    console.log(`\nResults saved to ${COMPARISON_PATH}`);

    // ── Pass criteria ─────────────────────────────────────────────
    const fitnessImproved = la.lateAvgFitness > la.earlyAvgFitness;
    const accuracyThreshold = la.accuracy >= 0.30;
    const withinDspy = dspyZeroshot !== null && la.accuracy >= dspyZeroshot - 0.10;
    const beatsStatic = staticResult !== null && la.accuracy > staticResult.accuracy;
    const passed = accuracyThreshold || withinDspy || fitnessImproved || beatsStatic;

    const metrics: Record<string, number> = {
      livingAgentAccuracy: la.accuracy,
      livingAgentCorrect: la.correct,
      earlyAvgFitness: la.earlyAvgFitness,
      lateAvgFitness: la.lateAvgFitness,
      totalTokensUsed: la.totalTokens,
    };
    if (staticResult) {
      metrics.staticBaselineAccuracy = staticResult.accuracy;
      metrics.staticBaselineCorrect = staticResult.correct;
      metrics.staticBaselineTokens = staticResult.totalTokens;
      metrics.evolutionDelta = la.accuracy - staticResult.accuracy;
    }
    if (dspyZeroshot !== null) metrics.dspyZeroshotAccuracy = dspyZeroshot;
    if (dspyBootstrap !== null) metrics.dspyBootstrapAccuracy = dspyBootstrap;

    const staticInfo = staticResult
      ? ` vs static ${(staticResult.accuracy * 100).toFixed(1)}% (${beatsStatic ? '+' : ''}${((la.accuracy - staticResult.accuracy) * 100).toFixed(1)}pp)`
      : '';

    return {
      passed,
      metrics,
      timeSeries: la.timeSeries,
      details: passed
        ? `Living-Agent ${(la.accuracy * 100).toFixed(1)}%${staticInfo}` +
          (dspyZeroshot !== null ? ` vs DSPy zero-shot ${(dspyZeroshot * 100).toFixed(1)}%` : '') +
          (dspyBootstrap !== null ? ` vs DSPy bootstrap ${(dspyBootstrap * 100).toFixed(1)}%` : '') +
          `, fitness: ${la.earlyAvgFitness.toFixed(3)} → ${la.lateAvgFitness.toFixed(3)}, tokens: ${la.totalTokens}`
        : `Living-Agent accuracy too low: ${(la.accuracy * 100).toFixed(1)}%${staticInfo}, fitness: ${la.earlyAvgFitness.toFixed(3)} → ${la.lateAvgFitness.toFixed(3)}`,
    };
  });
}
