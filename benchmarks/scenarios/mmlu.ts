// ================================================================
//  Scenario: MMLU — Calibrated Confidence across High-Risk Domains
//
//  Tests calibration on 3 EU AI Act high-risk domains:
//    - professional_medicine (healthcare)
//    - professional_law (justice)
//    - professional_accounting (financial)
//
//  For each domain:
//    Phase A: Static baseline (1 sample, temp=0.3)
//    Phase B: Evolve on train split, eval with calibration
//
//  Final: Per-domain + aggregate calibration report
//
//  Usage:
//    npx tsx benchmarks/run.ts --real --scenario=mmlu --cycles=15
//    npx tsx benchmarks/run.ts --real --scenario=mmlu --cycles=15 --domain=medicine
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
import { MMLUEvaluator, extractAnswer } from '../evaluators/mmlu-evaluator.js';
import type { MMLUSubject } from '../evaluators/mmlu-evaluator.js';
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

const VOTE_COUNT = 3;
const EVAL_SIZE = 100;
const CONCURRENCY = 4;
const LETTERS = ['A', 'B', 'C', 'D'];

const DOMAIN_PROMPTS: Record<MMLUSubject, string> = {
  medicine: `You are an expert medical professional answering clinical knowledge questions.

Instructions:
1. Read the question carefully.
2. Consider each option based on medical knowledge.
3. Use clinical reasoning to eliminate incorrect options.
4. Choose the best answer and respond with the letter (A, B, C, or D).

Important: Think step by step. End your response with "The answer is X" where X is A, B, C, or D.`,

  law: `You are an expert legal professional answering questions about law and jurisprudence.

Instructions:
1. Read the question carefully.
2. Consider each option based on legal principles and precedent.
3. Use legal reasoning to eliminate incorrect options.
4. Choose the best answer and respond with the letter (A, B, C, or D).

Important: Think step by step. End your response with "The answer is X" where X is A, B, C, or D.`,

  accounting: `You are an expert accountant answering professional accounting questions.

Instructions:
1. Read the question carefully.
2. Consider each option based on accounting standards and principles.
3. Use financial reasoning to eliminate incorrect options.
4. Choose the best answer and respond with the letter (A, B, C, or D).

Important: Think step by step. End your response with "The answer is X" where X is A, B, C, or D.`,
};

// ── Parse --domain= from CLI ──────────────────────────────────

function getRequestedDomains(): MMLUSubject[] {
  const domainArg = process.argv.find(a => a.startsWith('--domain='));
  if (domainArg) {
    const d = domainArg.slice(9) as MMLUSubject;
    if (['medicine', 'law', 'accounting'].includes(d)) return [d];
    console.warn(`  Unknown domain "${d}", running all domains.`);
  }
  return ['medicine', 'law', 'accounting'];
}

// ── Per-domain types ──────────────────────────────────────────

interface DomainResult {
  subject: MMLUSubject;
  staticAccuracy: number;
  staticCorrect: number;
  staticTotal: number;
  staticTokens: number;
  evolvedAccuracy: number;
  evolvedCorrect: number;
  evolvedTotal: number;
  evolvedTokens: number;
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

// ── Static Baseline ───────────────────────────────────────────

async function runStatic(
  subject: MMLUSubject,
  adapter: LLMAdapter,
  logger: BenchLogger,
): Promise<{ accuracy: number; correct: number; total: number; totalTokens: number }> {
  const evaluator = new MMLUEvaluator(subject, 'eval');
  const items = evaluator.getAllItems().slice(0, EVAL_SIZE);
  const systemPrompt = DOMAIN_PROMPTS[subject];

  let correct = 0;
  let totalTokens = 0;
  const total = items.length;

  for (let batchStart = 0; batchStart < items.length; batchStart += CONCURRENCY) {
    const batch = items.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item, batchIdx) => {
      const optionsText = item.options
        .map((opt, idx) => `${LETTERS[idx]}. ${opt}`)
        .join('\n');
      const prompt = `${item.question}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D). Think step by step, then end with "The answer is X".`;

      try {
        const start = Date.now();
        const response = await adapter.execute(prompt, {
          temperature: 0.3,
          maxTokens: 1500,
          systemPrompt,
          toolNames: [],
        });
        const score = evaluator.scoreById(item.id, response.content);
        const predicted = extractAnswer(response.content);

        logger.log({
          phase: 'static',
          itemIndex: batchStart + batchIdx,
          itemTotal: total,
          itemId: item.id,
          taskType: `mmlu-${subject}`,
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

// ── Evolution + Calibrated Eval ──────────────────────────────

async function runEvolved(
  subject: MMLUSubject,
  seed: number,
  cycles: number,
  adapter: LLMAdapter,
  logger: BenchLogger,
): Promise<{
  accuracy: number; correct: number; total: number;
  totalTokens: number; timeSeries: TimeSeriesPoint[];
  calibration: DomainResult['calibration'];
} | null> {
  resetGenomeCounter();

  const systemPromptTemplate = DOMAIN_PROMPTS[subject];
  const config = createDefaultConfig({
    strategyCount: 8,
    taskBatchSize: 8,
    cullThreshold: -5,
    systemPromptTemplate,
    minTokenBudget: 1200,
    enableCalibrationFitness: true,
  });

  const trainEvaluator = new MMLUEvaluator(subject, 'train');
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
        taskType: `mmlu-${subject}`,
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

  // Warm-up
  const WARMUP = 3;
  const origCull = config.cullThreshold;
  config.cullThreshold = -100;
  console.log(`    Warm-up (${WARMUP} cycles)...`);
  for (let i = 0; i < WARMUP; i++) {
    const stats = await ecology.runCycle();
    if (i === WARMUP - 1) {
      console.log(`    warm-up done: avg=${stats.avgFitness.toFixed(3)} best=${stats.bestFitness.toFixed(3)} pop=${stats.strategyCount}`);
    }
  }
  config.cullThreshold = origCull;

  // Evolve
  console.log(`    Evolving (${cycles} cycles)...`);
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

  // Calibration selection: top 2 strategies
  const allStrategies = [...ecology.getStrategies()].sort((a, b) => b.fitness - a.fitness);
  if (allStrategies.length === 0) throw new Error('No strategies survived');

  const TOP_N = Math.min(2, allStrategies.length);
  const CAL_SAMPLE = 15;
  const calItems = new MMLUEvaluator(subject, 'train').getAllItems().slice(0, CAL_SAMPLE);

  console.log(`    Calibration selection: top ${TOP_N} on ${CAL_SAMPLE} train items...`);

  let best = allStrategies[0];
  let bestCalFit = -Infinity;

  for (let si = 0; si < TOP_N; si++) {
    const candidate = allStrategies[si];
    const genome = candidate.genome;
    const voteN = genome.voteCount ?? VOTE_COUNT;
    const temp = Math.min(1, Math.max(0, genome.temperature));
    const tokens = Math.max(1200, genome.maxTokenBudget);
    const sysPrompt = buildSystemPrompt(config.systemPromptTemplate, genome, config.toolNames, candidate.taskTypeMemory);

    const calResults: ConfidenceResultWithGold[] = [];
    for (const item of calItems) {
      const optionsText = item.options.map((opt, idx) => `${LETTERS[idx]}. ${opt}`).join('\n');
      const prompt = `${item.question}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D). Think step by step, then end with "The answer is X".`;
      const votes = [0, 0, 0, 0];
      for (let v = 0; v < voteN; v++) {
        try {
          const resp = await adapter.execute(prompt, { temperature: temp, maxTokens: tokens, systemPrompt: sysPrompt, toolNames: [] });
          totalTokens += resp.tokensUsed;
          const pred = extractAnswer(resp.content);
          if (pred !== null) votes[pred]++;
        } catch { /* skip */ }
      }
      calResults.push({ result: evaluateConfidence(votes, genome), gold: item.correct_option });
    }

    const calMetrics = computeCalibrationMetrics(calResults);
    const calFit = calibrationFitness(calMetrics);
    console.log(`    strat ${si + 1}/${TOP_N} (${genome.id}): calFitness=${calFit.toFixed(4)} selAcc=${(calMetrics.selectiveAccuracy * 100).toFixed(1)}%`);

    if (calFit > bestCalFit) {
      bestCalFit = calFit;
      best = candidate;
    }
  }

  console.log(`    selected: ${best.genome.id}`);

  // Eval
  const evalTokenBudget = Math.max(1200, best.genome.maxTokenBudget);
  const evolvedVoteCount = best.genome.voteCount ?? VOTE_COUNT;
  const evolvedTemp = Math.min(1, Math.max(0, best.genome.temperature));
  const systemPrompt = buildSystemPrompt(config.systemPromptTemplate, best.genome, config.toolNames, best.taskTypeMemory);

  console.log(`    genome: temp=${best.genome.temperature.toFixed(2)} T1=${(best.genome.confidenceThresholdHigh ?? 0.3).toFixed(3)} T2=${(best.genome.confidenceThresholdLow ?? 0.8).toFixed(3)} votes=${evolvedVoteCount} policy=${best.genome.abstentionPolicy ?? 'refuse'}`);

  const evalEvaluator = new MMLUEvaluator(subject, 'eval');
  const evalItems = evalEvaluator.getAllItems().slice(0, EVAL_SIZE);
  let correct = 0;
  const total = evalItems.length;
  const allConfResults: ConfidenceResultWithGold[] = [];

  for (let batchStart = 0; batchStart < evalItems.length; batchStart += CONCURRENCY) {
    const batch = evalItems.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item, batchIdx) => {
      const optionsText = item.options.map((opt, idx) => `${LETTERS[idx]}. ${opt}`).join('\n');
      const prompt = `${item.question}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D). Think step by step, then end with "The answer is X".`;

      const votes = [0, 0, 0, 0];
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
        } catch { /* skip */ }
      }

      const confResult = evaluateConfidence(votes, best.genome);
      const gold = item.correct_option;
      const score = confResult.answer === gold ? 1 : 0;
      allConfResults.push({ result: confResult, gold });

      logger.log({
        phase: 'evolution-eval',
        itemIndex: batchStart + batchIdx,
        itemTotal: total,
        itemId: item.id,
        taskType: `mmlu-${subject}`,
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

  const calMetrics = computeCalibrationMetrics(allConfResults);
  const calFit = calibrationFitness(calMetrics);

  return {
    accuracy: correct / total,
    correct,
    total,
    totalTokens,
    timeSeries,
    calibration: {
      selectiveAccuracy: calMetrics.selectiveAccuracy,
      coverage: calMetrics.coverage,
      abstentionRate: calMetrics.abstentionRate,
      falseConfidenceRate: calMetrics.falseConfidenceRate,
      ece: calMetrics.expectedCalibrationError,
      calibrationFitness: calFit,
      buckets: calMetrics.buckets,
    },
  };
}

// ── Print calibration report ──────────────────────────────────

function printCalibration(label: string, cal: DomainResult['calibration']) {
  console.log(`\n  [${label}]`);
  console.log(`  Selective Accuracy: ${(cal.selectiveAccuracy * 100).toFixed(1)}%  Coverage: ${(cal.coverage * 100).toFixed(1)}%  Abstention: ${(cal.abstentionRate * 100).toFixed(1)}%`);
  console.log(`  False Confidence:   ${(cal.falseConfidenceRate * 100).toFixed(1)}%  ECE: ${cal.ece.toFixed(4)}  CalFitness: ${cal.calibrationFitness.toFixed(4)}`);
  console.log('  Buckets:');
  console.log('  Level     Count   Correct  Accuracy');
  for (const b of cal.buckets) {
    console.log(`  ${b.confidence.padEnd(8)}  ${String(b.count).padStart(5)}   ${String(b.correct).padStart(7)}   ${(b.accuracy * 100).toFixed(1)}%`);
  }
}

// ── Main Scenario ──────────────────────────────────────────────

export async function mmlu(
  seed: number,
  cycles = 15,
): Promise<BenchmarkResult> {
  return runBenchmark('mmlu', seed, async (s) => {
    const adapterInfo = await createBenchmarkAdapter();
    if (!adapterInfo) {
      return {
        passed: true,
        metrics: { skipped: 1 },
        timeSeries: [],
        details: 'Skipped: no working API found',
      };
    }

    const logger = new BenchLogger('mmlu');
    console.log(`  [Logs] ${logger.getLogPath()}`);

    const domains = getRequestedDomains();

    console.log('\n============================================================');
    console.log(`MMLU Calibration Benchmark — ${domains.length} domain(s), n=${EVAL_SIZE} per domain`);
    console.log(`LLM Provider: ${adapterInfo.name} (${adapterInfo.model})`);
    console.log(`Domains: ${domains.join(', ')}`);
    console.log('============================================================\n');

    const domainResults: DomainResult[] = [];
    let allTimeSeries: TimeSeriesPoint[] = [];

    for (const subject of domains) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Domain: ${subject.toUpperCase()}`);
      console.log(`${'─'.repeat(60)}`);

      // Phase A: Static
      console.log(`\n  Phase A: Static baseline`);
      const staticR = await runStatic(subject, adapterInfo.adapter, logger);
      console.log(`  Static accuracy: ${(staticR.accuracy * 100).toFixed(1)}% (${staticR.correct}/${staticR.total})\n`);

      // Phase B: Evolved + calibration
      console.log(`  Phase B: Evolution + calibrated eval`);
      const evolvedR = await runEvolved(subject, s, cycles, adapterInfo.adapter, logger);

      if (!evolvedR) {
        console.log('  Skipped: API not reachable');
        continue;
      }

      console.log(`  Evolved accuracy: ${(evolvedR.accuracy * 100).toFixed(1)}% (${evolvedR.correct}/${evolvedR.total})`);

      const delta = evolvedR.accuracy - staticR.accuracy;
      const sign = delta >= 0 ? '+' : '';
      console.log(`  Delta: ${sign}${(delta * 100).toFixed(1)}pp`);

      printCalibration(subject, evolvedR.calibration);

      domainResults.push({
        subject,
        staticAccuracy: staticR.accuracy,
        staticCorrect: staticR.correct,
        staticTotal: staticR.total,
        staticTokens: staticR.totalTokens,
        evolvedAccuracy: evolvedR.accuracy,
        evolvedCorrect: evolvedR.correct,
        evolvedTotal: evolvedR.total,
        evolvedTokens: evolvedR.totalTokens,
        calibration: evolvedR.calibration,
      });

      allTimeSeries = allTimeSeries.concat(evolvedR.timeSeries);
    }

    // ── Aggregate Report ──────────────────────────────────────

    console.log('\n============================================================');
    console.log('MMLU Cross-Domain Calibration Report');
    console.log('============================================================');
    console.log('');
    console.log('Domain            Static   Evolved  SelAcc   Coverage  ECE');
    console.log('─'.repeat(65));

    let totalStaticCorrect = 0, totalStaticTotal = 0;
    let totalEvolvedCorrect = 0, totalEvolvedTotal = 0;
    let totalStaticTokens = 0, totalEvolvedTokens = 0;

    for (const dr of domainResults) {
      const sel = (dr.calibration.selectiveAccuracy * 100).toFixed(1);
      const cov = (dr.calibration.coverage * 100).toFixed(1);
      const ece = dr.calibration.ece.toFixed(4);
      console.log(
        `${dr.subject.padEnd(18)}${(dr.staticAccuracy * 100).toFixed(1).padStart(5)}%   ${(dr.evolvedAccuracy * 100).toFixed(1).padStart(5)}%   ${sel.padStart(5)}%   ${cov.padStart(5)}%     ${ece}`,
      );
      totalStaticCorrect += dr.staticCorrect;
      totalStaticTotal += dr.staticTotal;
      totalEvolvedCorrect += dr.evolvedCorrect;
      totalEvolvedTotal += dr.evolvedTotal;
      totalStaticTokens += dr.staticTokens;
      totalEvolvedTokens += dr.evolvedTokens;
    }

    // Aggregate calibration from all domain buckets
    if (domainResults.length > 1) {
      const aggBuckets: Record<string, { count: number; correct: number }> = {
        HIGH: { count: 0, correct: 0 },
        MEDIUM: { count: 0, correct: 0 },
        LOW: { count: 0, correct: 0 },
      };
      for (const dr of domainResults) {
        for (const b of dr.calibration.buckets) {
          aggBuckets[b.confidence].count += b.count;
          aggBuckets[b.confidence].correct += b.correct;
        }
      }

      console.log('─'.repeat(65));
      const aggStatic = totalStaticCorrect / totalStaticTotal;
      const aggEvolved = totalEvolvedCorrect / totalEvolvedTotal;
      const answered = Object.values(aggBuckets).reduce((s, b) => s + b.count, 0) -
        aggBuckets.LOW.count;
      const aggSelAcc = answered > 0
        ? (aggBuckets.HIGH.correct + aggBuckets.MEDIUM.correct) / (aggBuckets.HIGH.count + aggBuckets.MEDIUM.count)
        : 0;
      const aggCov = Object.values(aggBuckets).reduce((s, b) => s + b.count, 0) > 0
        ? 1 - aggBuckets.LOW.count / Object.values(aggBuckets).reduce((s, b) => s + b.count, 0)
        : 0;

      console.log(
        `${'AGGREGATE'.padEnd(18)}${(aggStatic * 100).toFixed(1).padStart(5)}%   ${(aggEvolved * 100).toFixed(1).padStart(5)}%   ${(aggSelAcc * 100).toFixed(1).padStart(5)}%   ${(aggCov * 100).toFixed(1).padStart(5)}%`,
      );

      console.log('\n  Aggregate Confidence Buckets:');
      console.log('  Level     Count   Correct  Accuracy');
      for (const [level, b] of Object.entries(aggBuckets)) {
        const acc = b.count > 0 ? (b.correct / b.count * 100).toFixed(1) : '0.0';
        console.log(`  ${level.padEnd(8)}  ${String(b.count).padStart(5)}   ${String(b.correct).padStart(7)}   ${acc}%`);
      }
    }

    console.log('\n============================================================');

    // Save results JSON
    const resultsPath = resolve(RESULTS_DIR, 'mmlu-comparison.json');
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(resultsPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      domains: domainResults,
      totalStaticTokens,
      totalEvolvedTokens,
    }, null, 2));
    console.log(`\nResults saved to ${resultsPath}`);

    logger.logSummary({
      domains: domainResults.map(d => ({
        subject: d.subject,
        staticAccuracy: d.staticAccuracy,
        evolvedAccuracy: d.evolvedAccuracy,
        selectiveAccuracy: d.calibration.selectiveAccuracy,
        ece: d.calibration.ece,
      })),
    });
    console.log(`Detailed logs: ${logger.getLogPath()}`);

    // ── Pass criteria ────────────────────────────────────────

    const avgSelAcc = domainResults.length > 0
      ? domainResults.reduce((s, d) => s + d.calibration.selectiveAccuracy, 0) / domainResults.length
      : 0;
    const passed = domainResults.length > 0 && avgSelAcc > 0.5;

    const metrics: Record<string, number> = {
      domainsRun: domainResults.length,
      avgSelectiveAccuracy: avgSelAcc,
      totalTokensUsed: totalStaticTokens + totalEvolvedTokens,
    };

    for (const dr of domainResults) {
      metrics[`${dr.subject}_staticAccuracy`] = dr.staticAccuracy;
      metrics[`${dr.subject}_evolvedAccuracy`] = dr.evolvedAccuracy;
      metrics[`${dr.subject}_selectiveAccuracy`] = dr.calibration.selectiveAccuracy;
      metrics[`${dr.subject}_coverage`] = dr.calibration.coverage;
      metrics[`${dr.subject}_ece`] = dr.calibration.ece;
      metrics[`${dr.subject}_falseConfidence`] = dr.calibration.falseConfidenceRate;
    }

    const domainSummary = domainResults
      .map(d => `${d.subject}: sel=${(d.calibration.selectiveAccuracy * 100).toFixed(1)}%`)
      .join(', ');

    return {
      passed,
      metrics,
      timeSeries: allTimeSeries,
      details: `MMLU ${domainResults.length} domains: ${domainSummary}, tokens: ${totalStaticTokens + totalEvolvedTokens}`,
    };
  });
}
