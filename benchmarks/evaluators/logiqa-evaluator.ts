// ================================================================
//  LogiQA Evaluator — Logical reasoning, 4-choice multiple choice
//
//  Standard LogiQA metric: extract chosen letter (A/B/C/D) from
//  response, compare to correct_option (0-indexed).
//
//  score() gives a small gradient signal for valid-format wrong answers.
//  scoreById() uses strict binary 0/1 (for final reported metric).
// ================================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Task, TaskEvaluator } from '../../src/core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LogiQAItem {
  id: string;
  context: string;
  query: string;
  options: string[];
  correct_option: number; // 0-indexed: 0=A, 1=B, 2=C, 3=D
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * Extract the chosen letter (A/B/C/D) from an LLM response.
 *
 * Priority:
 * 1. Explicit patterns: "The answer is X", "Answer: X"
 * 2. Last standalone letter A-D in the response
 */
export function extractAnswer(response: string): number | null {
  const upper = response.toUpperCase();

  // 1. Explicit answer patterns (strongest signal)
  const explicit = upper.match(/(?:THE\s+)?ANSWER\s+IS\s*:?\s*([A-D])\b/);
  if (explicit) return LETTERS.indexOf(explicit[1] as typeof LETTERS[number]);

  const labeled = upper.match(/ANSWER\s*:\s*([A-D])\b/);
  if (labeled) return LETTERS.indexOf(labeled[1] as typeof LETTERS[number]);

  // 2. Selection patterns: "choose X", "select X", "option X is correct", "X is correct"
  const selection = upper.match(/(?:CHOOSE|SELECT|PICK)\s+([A-D])\b/);
  if (selection) return LETTERS.indexOf(selection[1] as typeof LETTERS[number]);

  const correct = upper.match(/\b([A-D])\s+IS\s+(?:THE\s+)?(?:CORRECT|RIGHT|BEST)\b/);
  if (correct) return LETTERS.indexOf(correct[1] as typeof LETTERS[number]);

  const optionCorrect = upper.match(/OPTION\s+([A-D])\b/g);
  if (optionCorrect && optionCorrect.length > 0) {
    const lastOpt = optionCorrect[optionCorrect.length - 1];
    const m = lastOpt.match(/([A-D])/);
    if (m) {
      // Only use if in the last 40% of the response
      const pos = upper.lastIndexOf(lastOpt);
      if (pos > upper.length * 0.6) {
        return LETTERS.indexOf(m[1] as typeof LETTERS[number]);
      }
    }
  }

  // 3. Bolded answer: **A**, **B** etc (common in markdown responses)
  const bolded = upper.match(/\*\*([A-D])\*\*/g);
  if (bolded && bolded.length > 0) {
    const last = bolded[bolded.length - 1].match(/([A-D])/);
    if (last) return LETTERS.indexOf(last[1] as typeof LETTERS[number]);
  }

  // 4. Last standalone A-D (word boundary on both sides)
  const allLetters = [...upper.matchAll(/\b([A-D])\b/g)];
  if (allLetters.length > 0) {
    const last = allLetters[allLetters.length - 1];
    return LETTERS.indexOf(last[1] as typeof LETTERS[number]);
  }

  return null;
}

export class LogiQAEvaluator implements TaskEvaluator {
  private items: LogiQAItem[];
  private goldAnswers = new Map<string, number>();
  private pointer = 0;

  constructor(split: 'train' | 'eval') {
    const filename = split === 'train' ? 'logiqa-train-200.json' : 'logiqa-eval-200.json';
    const filePath = resolve(__dirname, '..', 'data', filename);
    this.items = JSON.parse(readFileSync(filePath, 'utf-8')) as LogiQAItem[];

    for (const item of this.items) {
      this.goldAnswers.set(item.id, item.correct_option);
    }
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.items[this.pointer % this.items.length];
      this.pointer++;

      const optionsText = item.options
        .map((opt, idx) => `${LETTERS[idx]}. ${opt}`)
        .join('\n');

      tasks.push({
        id: item.id,
        type: 'logiqa',
        prompt: `${item.context}\n\nQuestion: ${item.query}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D).`,
        difficulty: 0.6, // LogiQA is moderately hard
        metadata: { correctOption: item.correct_option },
      });
    }
    return tasks;
  }

  /**
   * Fuzzy scoring for ecology evolution (gradient signal).
   * 1.0 = correct, 0.05 = valid letter but wrong, 0 = no valid answer
   */
  score(task: Task, response: string): number {
    const gold = this.goldAnswers.get(task.id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    if (predicted === gold) return 1.0;
    return 0.05; // valid format, wrong answer — tiny gradient signal
  }

  /** Get all items for direct evaluation */
  getAllItems(): LogiQAItem[] {
    return [...this.items];
  }

  /** Binary 0/1 scoring for final reported metric */
  scoreById(id: string, response: string): number {
    const gold = this.goldAnswers.get(id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    return predicted === gold ? 1 : 0;
  }
}
