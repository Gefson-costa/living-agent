// ================================================================
//  Benchmark Logger — Detailed per-item JSONL logging
//
//  Writes one JSON line per LLM call with full context:
//  task, strategy, parameters, score, timing, tokens.
//
//  Output: benchmarks/results/logs/<scenario>-<timestamp>.jsonl
// ================================================================

import { mkdirSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, 'results', 'logs');

export interface BenchLogEntry {
  timestamp: string;
  scenario: string;
  phase: 'static' | 'evolution-train' | 'evolution-eval';
  itemIndex: number;
  itemTotal: number;
  itemId: string;
  taskType?: string;
  strategyId?: string;
  genome?: {
    temperature: number;
    reasoningDepth: number;
    maxTokenBudget: number;
    habitatPref?: number;
    mutability?: number;
  };
  score: number;
  tokensUsed: number;
  inferenceMs: number;
  responseLength: number;
  prompt?: string;
  responsePreview?: string;
}

export class BenchLogger {
  private logPath: string;
  private scenario: string;
  private startTime: number;

  constructor(scenario: string) {
    this.scenario = scenario;
    this.startTime = Date.now();

    mkdirSync(LOGS_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.logPath = resolve(LOGS_DIR, `${scenario}-${ts}.jsonl`);

    // Write header comment
    this.writeRaw(JSON.stringify({
      _type: 'header',
      scenario,
      startedAt: new Date().toISOString(),
      logPath: this.logPath,
    }));
  }

  log(entry: Omit<BenchLogEntry, 'timestamp' | 'scenario'>): void {
    const full: BenchLogEntry = {
      timestamp: new Date().toISOString(),
      scenario: this.scenario,
      ...entry,
    };
    this.writeRaw(JSON.stringify(full));
  }

  /** Log an evolution cycle summary. */
  logCycle(cycle: number, totalCycles: number, stats: {
    avgFitness: number;
    bestFitness: number;
    strategyCount: number;
    elapsedMs: number;
  }): void {
    this.writeRaw(JSON.stringify({
      _type: 'cycle',
      timestamp: new Date().toISOString(),
      scenario: this.scenario,
      cycle,
      totalCycles,
      ...stats,
    }));
  }

  /** Log final summary. */
  logSummary(summary: Record<string, unknown>): void {
    this.writeRaw(JSON.stringify({
      _type: 'summary',
      timestamp: new Date().toISOString(),
      scenario: this.scenario,
      totalDurationMs: Date.now() - this.startTime,
      ...summary,
    }));
  }

  getLogPath(): string {
    return this.logPath;
  }

  private writeRaw(line: string): void {
    appendFileSync(this.logPath, line + '\n');
  }
}
