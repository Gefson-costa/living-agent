// ================================================================
//  GSM8K Evaluator — Grade-school math, integer exact-match
//
//  Standard GSM8K metric: extract last number from response,
//  strip commas, round to integer, compare === gold answer.
//
//  score() uses fuzzy tiers (for evolution gradient signal).
//  scoreById() uses strict binary 0/1 (for final reported metric).
// ================================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Task, TaskEvaluator } from '../../src/core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Gsm8kItem {
  id: string;
  question: string;
  answer: string;  // integer as string, e.g. "72"
}

/**
 * Extract the final numeric answer from an LLM response.
 * Looks for the last number in the text, strips commas.
 */
export function extractAnswer(response: string): number | null {
  // Strip commas inside numbers: "1,234" -> "1234"
  const cleaned = response.replace(/(\d),(\d)/g, '$1$2');
  // Find all numbers (including negative, decimal)
  const matches = cleaned.match(/-?\d+\.?\d*/g);
  if (!matches || matches.length === 0) return null;
  // Take the LAST number — GSM8K convention
  const last = matches[matches.length - 1];
  const parsed = parseFloat(last);
  if (isNaN(parsed)) return null;
  return Math.round(parsed);
}

/**
 * Fuzzy score using relative error tiers — gives evolution gradient signal.
 * Matches the MathEvaluator/ComplexEvaluator pattern.
 */
function scoreFuzzy(predicted: number, expected: number): number {
  if (Math.abs(expected) < 0.001) {
    return Math.abs(predicted) < 0.01 ? 1.0 : Math.max(0, 1 - Math.abs(predicted));
  }
  const relError = Math.abs((predicted - expected) / expected);
  if (relError < 0.001) return 1.0;   // exact match → full reward
  if (relError < 0.01)  return 0.3;   // very close → small gradient signal
  if (relError < 0.05)  return 0.1;   // close → tiny signal
  if (relError < 0.1)   return 0.05;  // near → near-zero
  return 0;                            // wrong → zero
}

export class Gsm8kEvaluator implements TaskEvaluator {
  private items: Gsm8kItem[];
  private goldAnswers = new Map<string, number>();
  private pointer = 0;

  constructor(split: 'train' | 'eval') {
    const filename = split === 'train' ? 'gsm8k-train-200.json' : 'gsm8k-eval-200.json';
    const filePath = resolve(__dirname, '..', 'data', filename);
    this.items = JSON.parse(readFileSync(filePath, 'utf-8')) as Gsm8kItem[];

    for (const item of this.items) {
      this.goldAnswers.set(item.id, parseInt(item.answer, 10));
    }
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.items[this.pointer % this.items.length];
      this.pointer++;
      tasks.push({
        id: item.id,
        type: 'gsm8k',
        prompt: item.question + '\n\nSolve this step by step, then give your final answer as a single number.',
        difficulty: 0.5,
        metadata: { goldAnswer: item.answer },
      });
    }
    return tasks;
  }

  /** Fuzzy scoring for ecology evolution (gradient signal) */
  score(task: Task, response: string): number {
    const gold = this.goldAnswers.get(task.id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    return scoreFuzzy(predicted, gold);
  }

  /** Get all items for direct evaluation (bypassing generateTasks cycling) */
  getAllItems(): Gsm8kItem[] {
    return [...this.items];
  }

  /** Binary 0/1 scoring for final reported metric (GSM8K standard) */
  scoreById(id: string, response: string): number {
    const gold = this.goldAnswers.get(id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    return predicted === gold ? 1 : 0;
  }
}
