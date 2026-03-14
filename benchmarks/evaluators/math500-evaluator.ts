// ================================================================
//  MATH-500 Evaluator — Competition-level math, LaTeX exact-match
//
//  Standard MATH metric: extract \boxed{...} from response,
//  normalize LaTeX, compare === gold answer.
//
//  score() uses hybrid fuzzy scoring (for evolution gradient signal).
//  scoreById() uses strict binary 0/1 (for final reported metric).
// ================================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Task, TaskEvaluator } from '../../src/core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Math500Item {
  id: string;
  problem: string;
  answer: string;   // LaTeX string, e.g. "\\frac{14}{3}", "\\sqrt{51}", "9"
  subject: string;
  level: string | number;
}

/**
 * Extract content from the last \boxed{...} in the text.
 * Nested-brace-aware parser (not regex), handles \boxed{\frac{a}{b}}.
 */
export function extractBoxed(response: string): string | null {
  const marker = '\\boxed{';
  const idx = response.lastIndexOf(marker);
  if (idx === -1) return null;

  const start = idx + marker.length;
  let depth = 1;
  let i = start;
  while (i < response.length && depth > 0) {
    if (response[i] === '{') depth++;
    else if (response[i] === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return response.slice(start, i - 1);
}

/**
 * Normalize a LaTeX answer string for comparison.
 * Strips \left, \right, \,, \!, whitespace; lowercases.
 */
export function normalizeLatex(s: string): string {
  let r = s.trim();
  // Remove \left and \right
  r = r.replace(/\\left/g, '').replace(/\\right/g, '');
  // Remove \, (thin space) and \! (negative thin space)
  r = r.replace(/\\,/g, '').replace(/\\!/g, '');
  // Remove \dfrac -> \frac, \tfrac -> \frac
  r = r.replace(/\\dfrac/g, '\\frac').replace(/\\tfrac/g, '\\frac');
  // Collapse all whitespace
  r = r.replace(/\s+/g, '');
  // Lowercase
  r = r.toLowerCase();
  return r;
}

/**
 * Try to parse a LaTeX string as a number.
 * Handles integers, decimals, simple fractions like \frac{a}{b}.
 */
function tryParseNumeric(s: string): number | null {
  const normalized = normalizeLatex(s);

  // Simple fraction: \frac{a}{b}
  const fracMatch = normalized.match(/^\\frac\{([^{}]+)\}\{([^{}]+)\}$/);
  if (fracMatch) {
    const num = parseFloat(fracMatch[1]);
    const den = parseFloat(fracMatch[2]);
    if (!isNaN(num) && !isNaN(den) && den !== 0) {
      return num / den;
    }
  }

  // Plain number (possibly negative, decimal)
  const cleaned = normalized.replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  if (!isNaN(parsed) && isFinite(parsed)) {
    return parsed;
  }

  return null;
}

/**
 * Fuzzy score using relative error tiers — gives evolution gradient signal.
 */
function scoreFuzzyNumeric(predicted: number, expected: number): number {
  if (Math.abs(expected) < 1e-9) {
    return Math.abs(predicted) < 0.01 ? 1.0 : Math.max(0, 1 - Math.abs(predicted));
  }
  const relError = Math.abs((predicted - expected) / expected);
  if (relError < 0.001) return 1.0;
  if (relError < 0.01)  return 0.9;
  if (relError < 0.05)  return 0.7;
  if (relError < 0.1)   return 0.5;
  if (relError < 0.3)   return 0.2;
  return 0;
}

/**
 * Simple string similarity (longest common subsequence ratio).
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0;

  // LCS length
  const m = a.length;
  const n = b.length;
  // Use two rows for space efficiency
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcsLen = prev[n];
  return (2 * lcsLen) / (m + n);
}

export class Math500Evaluator implements TaskEvaluator {
  private items: Math500Item[];
  private goldAnswers = new Map<string, string>();
  private pointer = 0;

  constructor(split: 'train' | 'eval') {
    const filename = split === 'train' ? 'math500-train-250.json' : 'math500-eval-250.json';
    const filePath = resolve(__dirname, '..', 'data', filename);
    this.items = JSON.parse(readFileSync(filePath, 'utf-8')) as Math500Item[];

    for (const item of this.items) {
      this.goldAnswers.set(item.id, item.answer);
    }
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.items[this.pointer % this.items.length];
      this.pointer++;
      tasks.push({
        id: item.id,
        type: 'math500',
        prompt: item.problem + '\n\nSolve this step by step. Put your final answer in \\boxed{}.',
        difficulty: 0.5,
        metadata: { goldAnswer: item.answer, subject: item.subject, level: item.level },
      });
    }
    return tasks;
  }

  /** Hybrid fuzzy scoring for ecology evolution (gradient signal) */
  score(task: Task, response: string): number {
    const gold = this.goldAnswers.get(task.id);
    if (gold === undefined) return 0;

    const extracted = extractBoxed(response);
    if (extracted === null) return 0;

    const normalizedGold = normalizeLatex(gold);
    const normalizedPred = normalizeLatex(extracted);

    // Exact normalized match
    if (normalizedPred === normalizedGold) return 1.0;

    // Try numeric comparison
    const goldNum = tryParseNumeric(gold);
    const predNum = tryParseNumeric(extracted);
    if (goldNum !== null && predNum !== null) {
      return scoreFuzzyNumeric(predNum, goldNum);
    }

    // String similarity fallback (partial credit for symbolic answers)
    const sim = stringSimilarity(normalizedPred, normalizedGold);
    if (sim >= 0.8) return 0.5;
    if (sim >= 0.5) return 0.2;
    return 0;
  }

  /** Get all items for direct evaluation (bypassing generateTasks cycling) */
  getAllItems(): Math500Item[] {
    return [...this.items];
  }

  /** Binary 0/1 scoring for final reported metric (MATH standard) */
  scoreById(id: string, response: string): number {
    const gold = this.goldAnswers.get(id);
    if (gold === undefined) return 0;

    const extracted = extractBoxed(response);
    if (extracted === null) return 0;

    const normalizedGold = normalizeLatex(gold);
    const normalizedPred = normalizeLatex(extracted);

    // Exact normalized string match
    if (normalizedPred === normalizedGold) return 1;

    // Also try numeric equivalence for answers like "9" vs "9.0"
    const goldNum = tryParseNumeric(gold);
    const predNum = tryParseNumeric(extracted);
    if (goldNum !== null && predNum !== null) {
      return Math.abs(goldNum - predNum) < 1e-6 ? 1 : 0;
    }

    return 0;
  }
}
