// ================================================================
//  Scenario: Real LLM Benchmark
//  Claim 7 — Evolution improves real LLM math scores
//
//  Uses auto-detected adapter with MathEvaluator for objective scoring.
//  Compares ecology (evolution) vs static baseline over 10 cycles.
//  Minimizes API cost: 5 strategies × 10 cycles ≈ 50 calls.
// ================================================================

import 'dotenv/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Ecology } from '../../src/evolution/ecology.js';
import { MathEvaluator } from '../../src/fitness/evaluator.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { resetGenomeCounter } from '../../src/evolution/genome.js';
import { StaticBaseline } from '../baselines.js';
import { createBenchmarkAdapter } from '../create-adapter.js';
import { createSeededRng, runBenchmark } from '../harness.js';
import type { BenchmarkResult, TimeSeriesPoint } from '../harness.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';

const verbose = process.argv.includes('--verbose');
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '..', '..', 'living-agent.sqlite');

// ── Logging helpers ──────────────────────────────────────────────

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const MAGENTA = '\x1b[35m';

function scoreColor(score: number): string {
  if (score >= 0.7) return GREEN;
  if (score >= 0.4) return YELLOW;
  return RED;
}

function fitnessBar(fitness: number, width = 20): string {
  const clamped = Math.max(0, Math.min(1, (fitness + 2) / 4)); // normalize roughly -2..2 → 0..1
  const filled = Math.round(clamped * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function timestamp(): string {
  return DIM + new Date().toISOString().slice(11, 19) + RESET;
}

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

    if (verbose) {
      console.log();
      console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
      console.log(`${BOLD}${CYAN}║  Living-Agent Real LLM Benchmark                    ║${RESET}`);
      console.log(`${BOLD}${CYAN}╠══════════════════════════════════════════════════════╣${RESET}`);
      console.log(`${CYAN}║${RESET}  Provider: ${BOLD}${adapterInfo.name}${RESET} (${adapterInfo.model})`);
      console.log(`${CYAN}║${RESET}  Strategies: ${config.strategyCount} | Cycles: ${cycles} | Seed: ${s}`);
      console.log(`${CYAN}║${RESET}  Mutation rate: ${config.mutationRate} | Elitism: ${config.elitismRate}`);
      console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}`);
      console.log();
    } else {
      console.log(`  [real-llm] Using ${adapterInfo.name} (${adapterInfo.model})`);
    }

    // ── Ecology (evolution) ──────────────────────────────────────
    resetGenomeCounter();
    const ecologyEval = new MathEvaluator(rng1);
    let ecologyTokens = 0;
    let taskCounter = 0;

    // Live dashboard: write results to SQLite so the dashboard can show them
    const store = new SqliteStore(DB_PATH);

    const ecology = new Ecology(config, adapter, ecologyEval, {
      onCycleStart: (cycle) => {
        if (verbose) {
          console.log(`${timestamp()} ${BOLD}${CYAN}── Cycle ${cycle}/${cycles} ──────────────────────────────────${RESET}`);
        }
      },
      onTaskComplete: (result) => {
        ecologyTokens += result.tokensUsed;
        taskCounter++;

        // Write to SQLite for live dashboard
        store.recordExperience({
          strategyId: result.strategyId,
          taskType: result.taskType,
          taskPrompt: result.taskId,
          response: result.response,
          score: result.score,
          tokensUsed: result.tokensUsed,
          latencyMs: result.latencyMs,
          fitnessSignal: result.score,
        });

        if (verbose) {
          const sc = scoreColor(result.score);
          const preview = result.response.replace(/\n/g, ' ').slice(0, 60);
          console.log(
            `${timestamp()}   ${DIM}task${RESET} ${result.taskType.padEnd(8)} ` +
            `${DIM}strategy${RESET} ${result.strategyId.slice(0, 10)} ` +
            `${DIM}score${RESET} ${sc}${result.score.toFixed(3)}${RESET} ` +
            `${DIM}tokens${RESET} ${result.tokensUsed} ` +
            `${DIM}${result.latencyMs}ms${RESET}` +
            `\n${DIM}            └─ "${preview}…"${RESET}`
          );
        }
      },
      onBirth: (strategy) => {
        if (verbose) {
          const g = strategy.genome;
          console.log(
            `${timestamp()}   ${GREEN}+ birth${RESET} ${g.id.slice(0, 10)} ` +
            `temp=${g.temperature.toFixed(2)} reasoning=${g.reasoningDepth.toFixed(2)} ` +
            `mutability=${g.mutability.toFixed(2)} habitat=${g.habitatPref.toFixed(2)}`
          );
        }
      },
      onDeath: (strategy) => {
        if (verbose) {
          console.log(
            `${timestamp()}   ${RED}✗ death${RESET} ${strategy.genome.id.slice(0, 10)} ` +
            `fitness=${strategy.fitness.toFixed(3)} age=${strategy.age}`
          );
        }
      },
      onCycleEnd: (stats) => {
        // Save strategies to SQLite for live dashboard
        for (const strat of ecology.getStrategies()) {
          store.saveStrategy(strat);
        }
        // Save MAP-Elites grid
        const rawGrid = ecology.getMapElites().getGrid();
        const filledGrid = rawGrid.filter(
          (c): c is { genome: import('../../src/core/types.js').StrategyGenome; fitness: number } => c !== null
        );
        if (filledGrid.length > 0) {
          store.saveGrid(filledGrid);
        }

        if (verbose) {
          const trend = stats.avgFitness >= 0 ? GREEN : RED;
          console.log(
            `${timestamp()}   ${MAGENTA}► cycle ${stats.cycle} summary${RESET} ` +
            `pop=${stats.strategyCount} ` +
            `avg=${trend}${stats.avgFitness.toFixed(3)}${RESET} ` +
            `best=${GREEN}${stats.bestFitness.toFixed(3)}${RESET} ` +
            `elites=${(stats.mapElitesCoverage * 100).toFixed(0)}% ` +
            `novelty=${stats.noveltyArchiveSize}`
          );

          // Show Elo ratings
          if (stats.eloRatings && Object.keys(stats.eloRatings).length > 0) {
            const sorted = Object.entries(stats.eloRatings)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5);
            const eloStr = sorted
              .map(([id, elo]) => `${id.slice(0, 8)}=${elo.toFixed(0)}`)
              .join(' ');
            console.log(`${timestamp()}   ${DIM}elo: ${eloStr}${RESET}`);
          }

          // Progress bar
          const pct = (stats.cycle / cycles * 100).toFixed(0);
          const filled = Math.round(stats.cycle / cycles * 30);
          console.log(
            `${timestamp()}   ${DIM}[${('█'.repeat(filled) + '░'.repeat(30 - filled))}] ${pct}%${RESET}`
          );
          console.log();
        }
      },
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
    if (verbose) {
      console.log(`${BOLD}${YELLOW}── Static Baseline (no evolution) ──────────────────────${RESET}`);
      console.log();
    }

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

    // Close SQLite connection
    store.close();

    if (verbose) {
      console.log();
      console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
      console.log(`${BOLD}${CYAN}║  RESULTS                                            ║${RESET}`);
      console.log(`${BOLD}${CYAN}╠══════════════════════════════════════════════════════╣${RESET}`);
      console.log(`${CYAN}║${RESET}  ${BOLD}Evolution:${RESET}`);
      console.log(`${CYAN}║${RESET}    Early avg fitness:  ${earlyAvgFitness.toFixed(4)}`);
      console.log(`${CYAN}║${RESET}    Late avg fitness:   ${lateAvgFitness.toFixed(4)}`);
      console.log(`${CYAN}║${RESET}    Improvement:        ${passed ? GREEN : RED}${(improvementRatio * 100).toFixed(1)}%${RESET}`);
      console.log(`${CYAN}║${RESET}    Best fitness:       ${GREEN}${ecologyFinalBest.toFixed(4)}${RESET}`);
      console.log(`${CYAN}║${RESET}    Tokens used:        ${ecologyTokens}`);
      console.log(`${CYAN}║${RESET}`);
      console.log(`${CYAN}║${RESET}  ${BOLD}Static Baseline:${RESET}`);
      console.log(`${CYAN}║${RESET}    Best fitness:       ${staticFinalBest.toFixed(4)}`);
      console.log(`${CYAN}║${RESET}    Tokens used:        ${staticTokens}`);
      console.log(`${CYAN}║${RESET}`);
      console.log(`${CYAN}║${RESET}  ${BOLD}Verdict:${RESET} ${passed ? `${GREEN}PASS ✓${RESET}` : `${RED}FAIL ✗${RESET}`}`);
      console.log(`${CYAN}║${RESET}    Evolution ${passed ? 'improved' : 'did NOT improve'} over ${cycles} cycles`);
      const advantage = ecologyFinalBest - staticFinalBest;
      console.log(`${CYAN}║${RESET}    vs Static: ${advantage >= 0 ? GREEN + '+' : RED}${advantage.toFixed(4)}${RESET}`);
      console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}`);
      console.log();
    }

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
