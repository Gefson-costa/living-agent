// ================================================================
//  SWE-bench Evaluator — Gold patch comparison with fuzzy scoring
//
//  Since we can't run repo tests on Windows, we use gold patch
//  comparison as a proxy. The LLM receives the issue description
//  and produces a unified diff, which is compared against the real
//  patch using multi-dimensional fuzzy scoring.
//
//  score() uses fuzzy 0..1 (for evolution gradient signal).
//  scoreById() uses binary: fuzzy >= 0.5 → 1, else 0.
// ================================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Task, TaskEvaluator } from '../../src/core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SwebenchItem {
  id: string;
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  patch: string;
  files_changed: string[];
  difficulty: string;
  hints_text: string;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Check if text looks like a valid unified diff (has headers + hunks). */
export function isValidUnifiedDiff(text: string): boolean {
  const hasMinusHeader = /^--- /m.test(text);
  const hasPlusHeader = /^\+\+\+ /m.test(text);
  const hasHunk = /^@@ /m.test(text);
  return hasMinusHeader && hasPlusHeader && hasHunk;
}

/** Extract file paths from unified diff +++ b/path and --- a/path headers. */
export function extractFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (plusMatch) {
      files.add(plusMatch[1]);
      continue;
    }
    const minusMatch = line.match(/^--- a\/(.+)$/);
    if (minusMatch) {
      files.add(minusMatch[1]);
    }
  }
  return [...files];
}

/** Extract added/removed lines from a unified diff (lines starting with + or - but not headers). */
export function extractChangeLines(diff: string): string[] {
  const lines: string[] = [];
  for (const line of diff.split('\n')) {
    // Skip diff headers
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
    // Collect added/removed lines
    if (line.startsWith('+') || line.startsWith('-')) {
      lines.push(line.slice(1).trim());
    }
  }
  // Filter out empty lines
  return lines.filter(l => l.length > 0);
}

/** Jaccard similarity between two string sets. */
export function setOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Normalize a patch for exact comparison: strip whitespace, normalize line endings. */
export function normalizePatch(patch: string): string {
  return patch
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.length > 0)
    .join('\n');
}

/** Convert SWE-bench difficulty label to a numeric value 0..1. */
export function difficultyToNumber(difficulty: string): number {
  const d = difficulty.toLowerCase();
  if (d.includes('15 min')) return 0.2;
  if (d.includes('1 hour') || d.includes('1 hr')) return 0.4;
  if (d.includes('4 hour') || d.includes('4 hr')) return 0.7;
  return 0.5; // unknown
}

// ── Prompt Builder ───────────────────────────────────────────────

const HINTS_MAX_CHARS = 2000;

export function buildSwebenchPrompt(item: SwebenchItem): string {
  const parts: string[] = [
    `Repository: ${item.repo}`,
    `Instance: ${item.instance_id}`,
    '',
    item.problem_statement,
    '',
    'Files to modify:',
    ...item.files_changed.map(f => `- ${f}`),
  ];

  if (item.hints_text && item.hints_text.trim().length > 0) {
    const hints = item.hints_text.length > HINTS_MAX_CHARS
      ? item.hints_text.slice(0, HINTS_MAX_CHARS) + '\n[truncated]'
      : item.hints_text;
    parts.push('', 'Discussion context:', hints);
  }

  parts.push(
    '',
    'Output ONLY the unified diff patch. Use --- a/path and +++ b/path headers with @@ hunk markers.',
  );
  return parts.join('\n');
}

// ── Fuzzy Scoring ────────────────────────────────────────────────

function scoreFuzzy(predicted: string, goldPatch: string, goldFiles: string[]): number {
  let score = 0;

  // Dimension 1: Is it a valid unified diff? (0.10)
  if (isValidUnifiedDiff(predicted)) {
    score += 0.10;
  }

  // Dimension 2: File overlap — Jaccard(files_predicted, files_gold) * 0.30
  const predictedFiles = extractFilesFromDiff(predicted);
  const fileOverlap = setOverlap(predictedFiles, goldFiles);
  score += fileOverlap * 0.30;

  // Dimension 3: Line-level similarity — Jaccard(change_lines) * 0.40
  const predictedLines = extractChangeLines(predicted);
  const goldLines = extractChangeLines(goldPatch);
  const lineOverlap = setOverlap(predictedLines, goldLines);
  score += lineOverlap * 0.40;

  // Dimension 4: Exact match bonus (0.20)
  if (normalizePatch(predicted) === normalizePatch(goldPatch)) {
    score += 0.20;
  }

  return Math.min(1.0, score);
}

// ── Evaluator Class ──────────────────────────────────────────────

export class SwebenchEvaluator implements TaskEvaluator {
  private items: SwebenchItem[];
  private itemIndex = new Map<string, SwebenchItem>();
  private pointer = 0;

  constructor(split: 'train' | 'eval') {
    const filename = split === 'train' ? 'swebench-train-250.json' : 'swebench-eval-250.json';
    const filePath = resolve(__dirname, '..', 'data', filename);
    this.items = JSON.parse(readFileSync(filePath, 'utf-8')) as SwebenchItem[];

    for (const item of this.items) {
      this.itemIndex.set(item.id, item);
    }
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.items[this.pointer % this.items.length];
      this.pointer++;
      tasks.push({
        id: item.id,
        type: 'swebench',
        prompt: buildSwebenchPrompt(item),
        difficulty: difficultyToNumber(item.difficulty),
        metadata: {
          instance_id: item.instance_id,
          repo: item.repo,
          files_changed: item.files_changed,
        },
      });
    }
    return tasks;
  }

  /** Fuzzy scoring for ecology evolution (gradient signal) */
  score(task: Task, response: string): number {
    const item = this.itemIndex.get(task.id);
    if (!item) return 0;
    return scoreFuzzy(response, item.patch, item.files_changed);
  }

  /** Get all items for direct evaluation (bypassing generateTasks cycling) */
  getAllItems(): SwebenchItem[] {
    return [...this.items];
  }

  /** Binary scoring for final reported metric: fuzzy >= 0.5 → 1, else 0 */
  scoreById(id: string, response: string): number {
    const item = this.itemIndex.get(id);
    if (!item) return 0;
    const fuzzy = scoreFuzzy(response, item.patch, item.files_changed);
    return fuzzy >= 0.5 ? 1 : 0;
  }
}
