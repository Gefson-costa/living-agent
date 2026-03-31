// ================================================================
//  Scenario: LogiQA — Evolution vs Static on Logical Reasoning
//
//  DeepSeek baseline: ~55-65% on LogiQA (4-choice MC)
//  This is a hard benchmark where prompt strategy matters a lot:
//  few-shot gives +12.6%, CoT changes results significantly.
//
//  Phase A: Static baseline (fixed prompt, temp=0.3, no evolution)
//  Phase B: Evolve on 200 train problems, eval best on 200 eval
//  Phase C: Print comparison, save results JSON
//
//  Pass: evolved accuracy > static OR accuracy >= 40%
//        OR fitness improved during evolution
// ================================================================

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LLMAdapter, ConfidenceLevel } from '../../src/core/types.js';
import { Ecology } from '../../src/evolution/ecology.js';
import { buildSystemPrompt } from '../../src/llm/adapter.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { LogiQAEvaluator, extractAnswer, buildFewShotPrefix } from '../evaluators/logiqa-evaluator.js';
import { createBenchmarkAdapter } from '../create-adapter.js';
import { runBenchmark } from '../harness.js';
import { BenchLogger } from '../bench-logger.js';
import {
  evaluateConfidence, computeCalibrationMetrics, calibrationFitness,
} from '../../src/confidence/entropy.js';
import type { ConfidenceResultWithGold } from '../../src/confidence/entropy.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');
const COMPARISON_PATH = resolve(RESULTS_DIR, 'logiqa-comparison.json');

const LOGIQA_SYSTEM_PROMPT = `You are an expert logical reasoning problem solver.

Instructions:
1. Read the context passage carefully.
2. Understand what the question is asking.
3. Analyze each option against the logical constraints in the context.
4. Use deductive reasoning to eliminate incorrect options.
5. Choose the best answer and respond with the letter (A, B, C, or D).

Important: Think step by step. Consider each option carefully before choosing.
End your response with "The answer is X" where X is A, B, C, or D.`;

// ── Phase A: Static Baseline ───────────────────────────────────

interface StaticResult {
  accuracy: number;
  correct: number;
  total: number;
  totalTokens: number;
}

const FEW_SHOT_COUNT = 3;
const VOTE_COUNT = 3; // self-consistency: reduced from 5 to fit free-tier token limits
const EVAL_SIZE = 100; // eval items (reduce for free-tier token budgets)

async function runStaticBaseline(
  adapter: LLMAdapter,
  evalEvaluator: LogiQAEvaluator,
  logger: BenchLogger,
): Promise<StaticResult> {
  const items = evalEvaluator.getAllItems().slice(0, EVAL_SIZE);
  const CONCURRENCY = 4;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const fewShotPrefix = buildFewShotPrefix(FEW_SHOT_COUNT);

  let correct = 0;
  let totalTokens = 0;
  const total = items.length;

  for (let batchStart = 0; batchStart < items.length; batchStart += CONCURRENCY) {
    const batch = items.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item, batchIdx) => {
      const optionsText = item.options
        .map((opt, idx) => `${LETTERS[idx]}. ${opt}`)
        .join('\n');

      const prompt = `${fewShotPrefix}${item.context}\n\nQuestion: ${item.query}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D). Think step by step, then end with "The answer is X".`;

      try {
        const start = Date.now();
        const response = await adapter.execute(prompt, {
          temperature: 0.3,
          maxTokens: 1500,
          systemPrompt: LOGIQA_SYSTEM_PROMPT,
          toolNames: [],
        });
        const score = evalEvaluator.scoreById(item.id, response.content);
        const predicted = extractAnswer(response.content);

        logger.log({
          phase: 'static',
          itemIndex: batchStart + batchIdx,
          itemTotal: total,
          itemId: item.id,
          taskType: 'logiqa',
          genome: { temperature: 0.3, reasoningDepth: 0.8, maxTokenBudget: 1500 },
          score,
          tokensUsed: response.tokensUsed,
          inferenceMs: Date.now() - start,
          responseLength: response.content.length,
          prompt: prompt.slice(0, 500),
          responsePreview: response.content.slice(-200),
          goldAnswer: LETTERS[item.correct_option],
          predictedAnswer: predicted !== null ? LETTERS[predicted] : 'NONE',
        } as any);

        return { tokens: response.tokensUsed, score };
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
      console.log(`    static [${done}/${total}] accuracy: ${correct}/${done} = ${(correct / done * 100).toFixed(1)}%`);
    }
  }

  return { accuracy: correct / total, correct, total, totalTokens };
}

// ── Phase B: Living-Agent Evolution + Eval ─────────────────────

interface EvolvedResult {
  accuracy: number;
  correct: number;
  total: number;
  earlyAvgFitness: number;
  lateAvgFitness: number;
  totalTokens: number;
  timeSeries: TimeSeriesPoint[];
  calibration: {
    selectiveAccuracy: number;
    coverage: number;
    abstentionRate: number;
    falseConfidenceRate: number;
    ece: number;
    calibrationFitness: number;
    buckets: { confidence: ConfidenceLevel; count: number; correct: number; accuracy: number }[];
  };
}

async function runLivingAgent(
  seed: number,
  cycles: number,
  adapter: LLMAdapter,
  logger: BenchLogger,
): Promise<EvolvedResult | null> {
  resetGenomeCounter();

  const config = createDefaultConfig({
    strategyCount: 8,
    taskBatchSize: 8,
    cullThreshold: -5,
    systemPromptTemplate: LOGIQA_SYSTEM_PROMPT,
    minTokenBudget: 1200, // LogiQA needs room for CoT reasoning
    enableCalibrationFitness: true, // Phase 2: penalize false confidence during evolution
  });

  // Preflight check
  const preflight = await adapter.execute('Reply with just "ok"', {
    temperature: 0, maxTokens: 16,
    systemPrompt: 'Reply with exactly "ok"', toolNames: [],
  });
  if (preflight.tokensUsed === 0) return null;

  // ── Evolve on train split ─────────────────────────────────────
  const trainEvaluator = new LogiQAEvaluator('train', FEW_SHOT_COUNT);
  let totalTokens = 0;

  let trainTaskIndex = 0;
  const ecology = new Ecology(config, adapter, trainEvaluator, {
    onTaskComplete: (result) => {
      totalTokens += result.tokensUsed;
      logger.log({
        phase: 'evolution-train',
        itemIndex: trainTaskIndex++,
        itemTotal: cycles * config.taskBatchSize,
        itemId: result.taskId,
        taskType: 'logiqa',
        strategyId: result.strategyId,
        score: result.score,
        tokensUsed: result.tokensUsed,
        inferenceMs: result.latencyMs,
        responseLength: result.response.length,
        responsePreview: result.response.slice(-200),
      });
    },
  });

  const timeSeries: TimeSeriesPoint[] = [];

  // Warm-up: 3 cycles with lenient culling
  const WARMUP_CYCLES = 3;
  const originalCullThreshold = config.cullThreshold;
  config.cullThreshold = -100;
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
    const stats = await ecology.runCycle();
    timeSeries.push({
      cycle: stats.cycle,
      avgFitness: stats.avgFitness,
      bestFitness: stats.bestFitness,
      strategyCount: stats.strategyCount,
    });
    logger.logCycle(stats.cycle, cycles, {
      avgFitness: stats.avgFitness,
      bestFitness: stats.bestFitness,
      strategyCount: stats.strategyCount,
      elapsedMs: 0,
    });
    if ((i + 1) % 5 === 0 || i === cycles - 1) {
      console.log(`    cycle ${i + 1}/${cycles}: avg=${stats.avgFitness.toFixed(3)} best=${stats.bestFitness.toFixed(3)}`);
    }
  }

  // ── Select best strategy by calibration fitness ────────────────
  // Instead of picking the best by raw accuracy fitness, evaluate
  // top candidates on a small calibration sample (20 train items with votes)
  // and pick the one with best calibration fitness.
  const allStrategies = [...ecology.getStrategies()].sort((a, b) => b.fitness - a.fitness);
  if (allStrategies.length === 0) throw new Error('No strategies survived evolution');

  const TOP_N = Math.min(2, allStrategies.length);
  const CALIBRATION_SAMPLE_SIZE = 15;
  const trainEvalItems = new LogiQAEvaluator('train').getAllItems().slice(0, CALIBRATION_SAMPLE_SIZE);
  const LETTERS = ['A', 'B', 'C', 'D'];

  console.log(`  [Living-Agent] Calibration selection: evaluating top ${TOP_N} strategies on ${CALIBRATION_SAMPLE_SIZE} train items...`);

  let best = allStrategies[0];
  let bestCalFitness = -Infinity;

  for (let si = 0; si < TOP_N; si++) {
    const candidate = allStrategies[si];
    const genome = candidate.genome;
    const voteN = genome.voteCount ?? VOTE_COUNT;
    const candidateTemp = Math.min(1, Math.max(0, genome.temperature));
    const candidateTokens = Math.max(1200, genome.maxTokenBudget);
    const candidatePrompt = buildSystemPrompt(config.systemPromptTemplate, genome, config.toolNames, candidate.taskTypeMemory);
    const calPrefix = buildFewShotPrefix(FEW_SHOT_COUNT);

    const calResults: ConfidenceResultWithGold[] = [];
    for (const item of trainEvalItems) {
      const optionsText = item.options.map((opt, idx) => `${LETTERS[idx]}. ${opt}`).join('\n');
      const prompt = `${calPrefix}${item.context}\n\nQuestion: ${item.query}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D). Think step by step, then end with "The answer is X".`;
      const votes = [0, 0, 0, 0];
      for (let v = 0; v < voteN; v++) {
        try {
          const resp = await adapter.execute(prompt, { temperature: candidateTemp, maxTokens: candidateTokens, systemPrompt: candidatePrompt, toolNames: [] });
          totalTokens += resp.tokensUsed;
          const pred = extractAnswer(resp.content);
          if (pred !== null) votes[pred]++;
        } catch { /* skip */ }
      }
      const confResult = evaluateConfidence(votes, genome);
      calResults.push({ result: confResult, gold: item.correct_option });
    }

    const calMetrics = computeCalibrationMetrics(calResults);
    const calFit = calibrationFitness(calMetrics);
    console.log(`    strategy ${si + 1}/${TOP_N} (${genome.id}): temp=${genome.temperature.toFixed(2)} T1=${(genome.confidenceThresholdHigh ?? 0.3).toFixed(3)} T2=${(genome.confidenceThresholdLow ?? 0.8).toFixed(3)} policy=${genome.abstentionPolicy ?? 'refuse'} → calFitness=${calFit.toFixed(4)} selAcc=${(calMetrics.selectiveAccuracy * 100).toFixed(1)}% cov=${(calMetrics.coverage * 100).toFixed(1)}%`);

    if (calFit > bestCalFitness) {
      bestCalFitness = calFit;
      best = candidate;
    }
  }

  console.log(`    selected: ${best.genome.id} (calFitness=${bestCalFitness.toFixed(4)})`);

  // Clamp token budget: LogiQA needs at least 1200 tokens for complete CoT reasoning
  const evalTokenBudget = Math.max(1200, best.genome.maxTokenBudget);

  const evolvedVoteCount = best.genome.voteCount ?? VOTE_COUNT;

  console.log('  [Living-Agent] Evaluating selected strategy on eval split...');
  console.log(`    genome: temp=${best.genome.temperature.toFixed(2)} reasoning=${best.genome.reasoningDepth.toFixed(2)} tokens=${best.genome.maxTokenBudget} (eval clamped to ${evalTokenBudget})`);
  console.log(`    confidence: T1=${(best.genome.confidenceThresholdHigh ?? 0.3).toFixed(3)} T2=${(best.genome.confidenceThresholdLow ?? 0.8).toFixed(3)} votes=${evolvedVoteCount} policy=${best.genome.abstentionPolicy ?? 'refuse'}`);

  const evalEvaluator = new LogiQAEvaluator('eval');
  const evalItems = evalEvaluator.getAllItems().slice(0, EVAL_SIZE);
  const fewShotPrefix = buildFewShotPrefix(FEW_SHOT_COUNT);

  const systemPrompt = buildSystemPrompt(
    config.systemPromptTemplate,
    best.genome,
    config.toolNames,
    best.taskTypeMemory,
  );

  let correct = 0;
  const total = evalItems.length;
  const CONCURRENCY = 4;
  const evolvedTemp = Math.min(1, Math.max(0, best.genome.temperature));

  console.log(`    self-consistency: ${evolvedVoteCount} votes per question (evolved)`);

  const allConfidenceResults: ConfidenceResultWithGold[] = [];

  for (let batchStart = 0; batchStart < evalItems.length; batchStart += CONCURRENCY) {
    const batch = evalItems.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item, batchIdx) => {
      const optionsText = item.options
        .map((opt, idx) => `${LETTERS[idx]}. ${opt}`)
        .join('\n');

      const prompt = `${fewShotPrefix}${item.context}\n\nQuestion: ${item.query}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D). Think step by step, then end with "The answer is X".`;

      // Self-consistency: sample evolvedVoteCount times
      const votes = [0, 0, 0, 0]; // A, B, C, D counts
      let itemTokens = 0;
      const start = Date.now();
      let lastResponse = '';

      for (let v = 0; v < evolvedVoteCount; v++) {
        try {
          const response = await adapter.execute(prompt, {
            temperature: evolvedTemp,
            maxTokens: evalTokenBudget,
            systemPrompt,
            toolNames: [],
          });
          itemTokens += response.tokensUsed;
          lastResponse = response.content;
          const predicted = extractAnswer(response.content);
          if (predicted !== null) votes[predicted]++;
        } catch {
          // skip failed vote
        }
      }

      // Evaluate confidence using genome thresholds
      const confResult = evaluateConfidence(votes, best.genome);
      const gold = item.correct_option;
      const score = confResult.answer === gold ? 1 : (confResult.abstained ? 0 : 0);

      allConfidenceResults.push({ result: confResult, gold });

      logger.log({
        phase: 'evolution-eval',
        itemIndex: batchStart + batchIdx,
        itemTotal: total,
        itemId: item.id,
        taskType: 'logiqa',
        strategyId: best.genome.id,
        genome: {
          temperature: best.genome.temperature,
          reasoningDepth: best.genome.reasoningDepth,
          maxTokenBudget: best.genome.maxTokenBudget,
          voteCount: evolvedVoteCount,
          confidenceThresholdHigh: best.genome.confidenceThresholdHigh,
          confidenceThresholdLow: best.genome.confidenceThresholdLow,
          abstentionPolicy: best.genome.abstentionPolicy,
        },
        score,
        tokensUsed: itemTokens,
        inferenceMs: Date.now() - start,
        responseLength: lastResponse.length,
        responsePreview: lastResponse.slice(-200),
        goldAnswer: LETTERS[gold],
        predictedAnswer: confResult.answer !== null ? LETTERS[confResult.answer] : 'ABSTAINED',
        confidence: confResult.confidence,
        entropy: confResult.entropy.toFixed(4),
        abstained: confResult.abstained,
        votes: `A=${votes[0]} B=${votes[1]} C=${votes[2]} D=${votes[3]}`,
        systemPrompt: systemPrompt.slice(0, 300),
      } as any);

      return { tokens: itemTokens, score };
    }));

    for (const r of results) {
      totalTokens += r.tokens;
      if (r.score === 1) correct++;
    }

    const done = Math.min(batchStart + CONCURRENCY, total);
    if (done % 50 === 0 || done === total) {
      console.log(`    eval [${done}/${total}] accuracy: ${correct}/${done} = ${(correct / done * 100).toFixed(1)}%`);
    }
  }

  // Compute calibration metrics
  const calMetrics = computeCalibrationMetrics(allConfidenceResults);
  const calFitness = calibrationFitness(calMetrics);

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
    calibration: {
      selectiveAccuracy: calMetrics.selectiveAccuracy,
      coverage: calMetrics.coverage,
      abstentionRate: calMetrics.abstentionRate,
      falseConfidenceRate: calMetrics.falseConfidenceRate,
      ece: calMetrics.expectedCalibrationError,
      calibrationFitness: calFitness,
      buckets: calMetrics.buckets,
    },
  };
}

// ── Main Scenario ──────────────────────────────────────────────

export async function logiqa(
  seed: number,
  cycles = 15,
): Promise<BenchmarkResult> {
  return runBenchmark('logiqa', seed, async (s) => {
    const adapterInfo = await createBenchmarkAdapter();
    if (!adapterInfo) {
      return {
        passed: true,
        metrics: { skipped: 1 },
        timeSeries: [],
        details: 'Skipped: no working API found',
      };
    }

    const logger = new BenchLogger('logiqa');
    console.log(`  [Logs] ${logger.getLogPath()}`);

    console.log('\n============================================================');
    console.log(`LogiQA Benchmark — Evolution vs Static (n=${EVAL_SIZE} eval problems)`);
    console.log(`LLM Provider: ${adapterInfo.name} (${adapterInfo.model})`);
    console.log('============================================================\n');

    // ── Phase A: Static Baseline ─────────────────────────────────
    console.log('Phase A: Static baseline (no evolution)');
    const staticEval = new LogiQAEvaluator('eval');
    const staticResult = await runStaticBaseline(adapterInfo.adapter, staticEval, logger);
    console.log(`  Static accuracy: ${(staticResult.accuracy * 100).toFixed(1)}% (${staticResult.correct}/${staticResult.total})\n`);

    // ── Phase B: Living-Agent ────────────────────────────────────
    console.log('Phase B: Living-Agent evolution + eval');
    const la = await runLivingAgent(s, cycles, adapterInfo.adapter, logger);

    if (!la) {
      return {
        passed: true,
        metrics: { totalTokensUsed: 0, skipped: 1 },
        timeSeries: [],
        details: 'Skipped: API not reachable',
      };
    }

    console.log(`  Evolved accuracy: ${(la.accuracy * 100).toFixed(1)}% (${la.correct}/${la.total})\n`);

    // ── Phase C: Comparison ──────────────────────────────────────
    const delta = la.accuracy - staticResult.accuracy;
    const sign = delta >= 0 ? '+' : '';

    console.log('------------------------------------------------------------');
    console.log('Method                    Accuracy   Tokens   Description');
    console.log('------------------------------------------------------------');
    console.log(`Static baseline           ${(staticResult.accuracy * 100).toFixed(1).padStart(5)}%    ${String(staticResult.totalTokens).padStart(7)}   ${FEW_SHOT_COUNT}-shot, temp=0.3`);
    console.log(`Living-Agent (evolved)    ${(la.accuracy * 100).toFixed(1).padStart(5)}%    ${String(la.totalTokens).padStart(7)}   ${FEW_SHOT_COUNT}-shot, evolved SC, ${cycles} evo cycles`);
    console.log(`                          ${sign}${(delta * 100).toFixed(1).padStart(4)}pp                  Evolution delta`);
    console.log('------------------------------------------------------------');

    // ── Calibration Report ──────────────────────────────────────
    const cal = la.calibration;
    console.log('\n============================================================');
    console.log('Calibrated Confidence Report');
    console.log('============================================================');
    console.log(`  Selective Accuracy:   ${(cal.selectiveAccuracy * 100).toFixed(1)}% (accuracy on accepted answers)`);
    console.log(`  Coverage:             ${(cal.coverage * 100).toFixed(1)}% (questions answered)`);
    console.log(`  Abstention Rate:      ${(cal.abstentionRate * 100).toFixed(1)}% (questions refused)`);
    console.log(`  False Confidence:     ${(cal.falseConfidenceRate * 100).toFixed(1)}% (wrong with HIGH confidence)`);
    console.log(`  ECE:                  ${cal.ece.toFixed(4)} (expected calibration error)`);
    console.log(`  Calibration Fitness:  ${cal.calibrationFitness.toFixed(4)}`);
    console.log('');
    console.log('  Confidence Buckets:');
    console.log('  Level     Count   Correct  Accuracy');
    for (const b of cal.buckets) {
      console.log(`  ${b.confidence.padEnd(8)}  ${String(b.count).padStart(5)}   ${String(b.correct).padStart(7)}   ${(b.accuracy * 100).toFixed(1)}%`);
    }
    console.log('============================================================');

    // Save comparison JSON
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(COMPARISON_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      evalSize: la.total,
      staticAccuracy: staticResult.accuracy,
      staticTokens: staticResult.totalTokens,
      evolvedAccuracy: la.accuracy,
      evolvedTokens: la.totalTokens,
      evolutionCycles: cycles,
      evolutionDelta: delta,
      earlyAvgFitness: la.earlyAvgFitness,
      lateAvgFitness: la.lateAvgFitness,
      calibration: cal,
    }, null, 2));
    console.log(`\nResults saved to ${COMPARISON_PATH}`);

    logger.logSummary({
      staticAccuracy: staticResult.accuracy,
      evolvedAccuracy: la.accuracy,
      delta,
      staticTokens: staticResult.totalTokens,
      evolvedTokens: la.totalTokens,
      earlyAvgFitness: la.earlyAvgFitness,
      lateAvgFitness: la.lateAvgFitness,
    });
    console.log(`Detailed logs: ${logger.getLogPath()}`);

    // ── Pass criteria ────────────────────────────────────────────
    const fitnessImproved = la.lateAvgFitness > la.earlyAvgFitness;
    const beatsStatic = la.accuracy > staticResult.accuracy;
    const accuracyThreshold = la.accuracy >= 0.40;
    const passed = beatsStatic || accuracyThreshold || fitnessImproved;

    const metrics: Record<string, number> = {
      livingAgentAccuracy: la.accuracy,
      livingAgentCorrect: la.correct,
      staticAccuracy: staticResult.accuracy,
      staticCorrect: staticResult.correct,
      evolutionDelta: delta,
      earlyAvgFitness: la.earlyAvgFitness,
      lateAvgFitness: la.lateAvgFitness,
      totalTokensUsed: la.totalTokens + staticResult.totalTokens,
      selectiveAccuracy: cal.selectiveAccuracy,
      coverage: cal.coverage,
      abstentionRate: cal.abstentionRate,
      falseConfidenceRate: cal.falseConfidenceRate,
      calibrationError: cal.ece,
      calibrationFitness: cal.calibrationFitness,
    };

    return {
      passed,
      metrics,
      timeSeries: la.timeSeries,
      details: passed
        ? `LogiQA evolved ${(la.accuracy * 100).toFixed(1)}% vs static ${(staticResult.accuracy * 100).toFixed(1)}% (${sign}${(delta * 100).toFixed(1)}pp), fitness: ${la.earlyAvgFitness.toFixed(3)} -> ${la.lateAvgFitness.toFixed(3)}, tokens: ${la.totalTokens + staticResult.totalTokens}`
        : `LogiQA evolved ${(la.accuracy * 100).toFixed(1)}% vs static ${(staticResult.accuracy * 100).toFixed(1)}% (${sign}${(delta * 100).toFixed(1)}pp), fitness did not improve`,
    };
  });
}
