// ================================================================
//  Scenario: Head-to-head — Living-Agent vs GEPA vs MIPROv2 vs DSPy
//
//  5-way comparison on MATH-500:
//    1. DSPy Zero-shot CoT (cached from math500_baseline.py)
//    2. DSPy BootstrapFewShot (cached from math500_baseline.py)
//    3. DSPy GEPA (gepa_math500.py)
//    4. DSPy MIPROv2 (miprov2_math500.py)
//    5. Living-Agent (evolved ecology)
//
//  Graceful fallback: if GEPA/MIPROv2 not installed, skip with warning.
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
import { createBenchmarkAdapter } from '../create-adapter.js';
import { runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');
const DSPY_DIR = resolve(__dirname, '..', 'dspy');

const DSPY_RESULTS_PATH = resolve(RESULTS_DIR, 'dspy-math500.json');
const GEPA_RESULTS_PATH = resolve(RESULTS_DIR, 'gepa-math500.json');
const MIPROV2_RESULTS_PATH = resolve(RESULTS_DIR, 'miprov2-math500.json');
const OUTPUT_PATH = resolve(RESULTS_DIR, 'headtohead-math500.json');

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ── Utilities ────────────────────────────────────────────────────

function isCacheValid(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return (Date.now() - statSync(path).mtimeMs) < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('python', args, {
      env: { ...process.env },
      timeout: 30 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr);
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function hasPythonModule(name: string): Promise<boolean> {
  try {
    await runPython(['-c', `import ${name}`]);
    return true;
  } catch {
    return false;
  }
}

interface MethodResult {
  accuracy: number;
  correct: number;
  total: number;
  duration_s?: number;
  error?: string;
}

function loadJsonResult(path: string, key: string): MethodResult | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return data[key] ?? null;
  } catch {
    return null;
  }
}

// ── DSPy Baselines (reuse existing script + cache) ───────────────

async function runDspyBaselines(): Promise<{ zeroshot: MethodResult | null; bootstrap: MethodResult | null }> {
  const script = resolve(DSPY_DIR, 'math500_baseline.py');

  if (isCacheValid(DSPY_RESULTS_PATH)) {
    console.log('  [DSPy] Using cached baselines (< 24h old)');
  } else {
    const hasKey = !!(process.env.DEEPSEEK_API_KEY || process.env.OPENROUTER_API_KEY || process.env.TOGETHER_API_KEY);
    if (!hasKey) {
      console.log('  [DSPy] Skipped: no API key');
      return { zeroshot: null, bootstrap: null };
    }
    if (!(await hasPythonModule('dspy'))) {
      console.log('  [DSPy] Skipped: dspy not installed');
      return { zeroshot: null, bootstrap: null };
    }

    console.log('  [DSPy] Running baselines...');
    mkdirSync(RESULTS_DIR, { recursive: true });
    try {
      await runPython([script]);
    } catch (err) {
      console.log(`  [DSPy] Script error: ${err instanceof Error ? err.message.slice(0, 100) : ''}`);
    }
  }

  return {
    zeroshot: loadJsonResult(DSPY_RESULTS_PATH, 'zeroshot'),
    bootstrap: loadJsonResult(DSPY_RESULTS_PATH, 'bootstrap'),
  };
}

// ── GEPA ─────────────────────────────────────────────────────────

async function runGepa(): Promise<MethodResult | null> {
  const script = resolve(DSPY_DIR, 'gepa_math500.py');

  if (isCacheValid(GEPA_RESULTS_PATH)) {
    console.log('  [GEPA] Using cached results (< 24h old)');
    return loadJsonResult(GEPA_RESULTS_PATH, 'gepa');
  }

  if (!(await hasPythonModule('dspy'))) {
    console.log('  [GEPA] Skipped: dspy not installed');
    return null;
  }

  console.log('  [GEPA] Running (this may take a while)...');
  mkdirSync(RESULTS_DIR, { recursive: true });
  try {
    await runPython([script]);
    return loadJsonResult(GEPA_RESULTS_PATH, 'gepa');
  } catch (err) {
    console.log(`  [GEPA] Failed: ${err instanceof Error ? err.message.slice(0, 100) : ''}`);
    return null;
  }
}

// ── MIPROv2 ──────────────────────────────────────────────────────

async function runMiprov2(): Promise<MethodResult | null> {
  const script = resolve(DSPY_DIR, 'miprov2_math500.py');

  if (isCacheValid(MIPROV2_RESULTS_PATH)) {
    console.log('  [MIPROv2] Using cached results (< 24h old)');
    return loadJsonResult(MIPROV2_RESULTS_PATH, 'miprov2');
  }

  if (!(await hasPythonModule('dspy'))) {
    console.log('  [MIPROv2] Skipped: dspy not installed');
    return null;
  }

  console.log('  [MIPROv2] Running (this may take a while)...');
  mkdirSync(RESULTS_DIR, { recursive: true });
  try {
    await runPython([script]);
    return loadJsonResult(MIPROV2_RESULTS_PATH, 'miprov2');
  } catch (err) {
    console.log(`  [MIPROv2] Failed: ${err instanceof Error ? err.message.slice(0, 100) : ''}`);
    return null;
  }
}

// ── Living-Agent ─────────────────────────────────────────────────

interface LAResult {
  accuracy: number;
  correct: number;
  total: number;
  totalTokens: number;
  timeSeries: TimeSeriesPoint[];
}

async function runLivingAgent(
  seed: number,
  cycles: number,
  adapter: LLMAdapter,
): Promise<LAResult | null> {
  resetGenomeCounter();

  const config = createDefaultConfig({
    strategyCount: 8,
    taskBatchSize: 8,
    cullThreshold: -5,
  });

  const preflight = await adapter.execute('Reply with just "ok"', {
    temperature: 0, maxTokens: 16,
    systemPrompt: 'Reply with exactly "ok"', toolNames: [],
  });
  if (preflight.tokensUsed === 0) return null;

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

  const best = ecology.getBestStrategy();
  if (!best) return null;

  console.log('  [Living-Agent] Evaluating on eval split...');
  const evalEvaluator = new Math500Evaluator('eval');
  const evalItems = evalEvaluator.getAllItems();
  const systemPrompt = buildSystemPrompt(
    config.systemPromptTemplate, best.genome, config.toolNames, best.taskTypeMemory,
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

  console.log(`  [Living-Agent] accuracy: ${(correct / total * 100).toFixed(1)}%`);
  return { accuracy: correct / total, correct, total, totalTokens, timeSeries };
}

// ── Main Scenario ────────────────────────────────────────────────

export async function headtohead(
  seed: number,
  cycles = 20,
): Promise<BenchmarkResult> {
  return runBenchmark('headtohead', seed, async (s) => {
    const adapterInfo = await createBenchmarkAdapter();
    if (!adapterInfo) {
      return {
        passed: true,
        metrics: { skipped: 1 },
        timeSeries: [],
        details: 'Skipped: no working API found',
      };
    }

    console.log('\n================================================================');
    console.log('Head-to-Head — MATH-500 (5-way comparison)');
    console.log(`LLM Provider: ${adapterInfo.name} (${adapterInfo.model})`);
    console.log('================================================================\n');

    // Run all methods
    console.log('Phase 1: DSPy baselines');
    const dspy = await runDspyBaselines();

    console.log('\nPhase 2: GEPA');
    const gepa = await runGepa();

    console.log('\nPhase 3: MIPROv2');
    const miprov2 = await runMiprov2();

    console.log('\nPhase 4: Living-Agent');
    const la = await runLivingAgent(s, cycles, adapterInfo.adapter);

    if (!la) {
      return {
        passed: true,
        metrics: { totalTokensUsed: 0, skipped: 1 },
        timeSeries: [],
        details: 'Skipped: API not reachable',
      };
    }

    // Print comparison table
    console.log('\n────────────────────────────────────────────────────────────────');
    console.log('Framework                 Accuracy   Method');
    console.log('────────────────────────────────────────────────────────────────');
    if (dspy.zeroshot) {
      console.log(`DSPy Zero-shot CoT        ${(dspy.zeroshot.accuracy * 100).toFixed(1).padStart(5)}%     No optimization`);
    }
    if (dspy.bootstrap) {
      console.log(`DSPy BootstrapFewShot     ${(dspy.bootstrap.accuracy * 100).toFixed(1).padStart(5)}%     50 train examples`);
    }
    if (gepa) {
      console.log(`DSPy GEPA                 ${(gepa.accuracy * 100).toFixed(1).padStart(5)}%     20 iterations`);
    }
    if (miprov2) {
      console.log(`DSPy MIPROv2              ${(miprov2.accuracy * 100).toFixed(1).padStart(5)}%     auto="medium"`);
    }
    console.log(`Living-Agent (evolved)    ${(la.accuracy * 100).toFixed(1).padStart(5)}%     ${cycles} evolution cycles`);
    console.log('────────────────────────────────────────────────────────────────');

    // Save JSON
    mkdirSync(RESULTS_DIR, { recursive: true });
    const comparison = {
      timestamp: new Date().toISOString(),
      evalSize: la.total,
      dspyZeroshotAccuracy: dspy.zeroshot?.accuracy ?? null,
      dspyBootstrapAccuracy: dspy.bootstrap?.accuracy ?? null,
      gepaAccuracy: gepa?.accuracy ?? null,
      miprov2Accuracy: miprov2?.accuracy ?? null,
      livingAgentAccuracy: la.accuracy,
      livingAgentEvolutionCycles: cycles,
      livingAgentTotalTokens: la.totalTokens,
    };
    writeFileSync(OUTPUT_PATH, JSON.stringify(comparison, null, 2));
    console.log(`\nResults saved to ${OUTPUT_PATH}`);

    // Metrics
    const metrics: Record<string, number> = {
      livingAgentAccuracy: la.accuracy,
      livingAgentCorrect: la.correct,
      totalTokensUsed: la.totalTokens,
    };
    if (dspy.zeroshot) metrics.dspyZeroshotAccuracy = dspy.zeroshot.accuracy;
    if (dspy.bootstrap) metrics.dspyBootstrapAccuracy = dspy.bootstrap.accuracy;
    if (gepa) metrics.gepaAccuracy = gepa.accuracy;
    if (miprov2) metrics.miprov2Accuracy = miprov2.accuracy;

    // Pass criteria
    const passed = la.accuracy >= 0.30 ||
      (dspy.zeroshot !== null && la.accuracy >= (dspy.zeroshot?.accuracy ?? 0) - 0.10);

    return {
      passed,
      metrics,
      timeSeries: la.timeSeries,
      details: `LA: ${(la.accuracy * 100).toFixed(1)}%` +
        (dspy.zeroshot ? ` | ZS-CoT: ${(dspy.zeroshot.accuracy * 100).toFixed(1)}%` : '') +
        (dspy.bootstrap ? ` | Bootstrap: ${(dspy.bootstrap.accuracy * 100).toFixed(1)}%` : '') +
        (gepa ? ` | GEPA: ${(gepa.accuracy * 100).toFixed(1)}%` : '') +
        (miprov2 ? ` | MIPROv2: ${(miprov2.accuracy * 100).toFixed(1)}%` : '') +
        `, tokens: ${la.totalTokens}`,
    };
  });
}
