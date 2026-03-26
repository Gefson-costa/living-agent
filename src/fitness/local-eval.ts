// ================================================================
//  Local Self-Eval — Evaluate response quality without LLM calls
//
//  Uses heuristic signals (length, structure, keyword overlap) to
//  estimate quality. Returns score + confidence. When confidence is
//  low, the caller should fall back to LLM self-eval.
//
//  Ref: evolution.md #31 — Self-Eval Local + LLM Budget
// ================================================================

import type { Task } from '../core/types.js';

export interface LocalEvalResult {
  score: number;       // 0..1, estimated quality
  confidence: number;  // 0..1, how sure we are (low → call LLM)
  method: 'local' | 'llm';
}

export interface LLMBudget {
  /** Fraction of interactions that get LLM self-eval (0..1, default 0.3). */
  selfEvalRate: number;
  /** Force LLM eval if local score is below this threshold (default 0.35). */
  forceLLMEvalThreshold: number;
  /** Force LLM eval for a genome's first N interactions (default 5). */
  newGenomeInteractions: number;
}

export const DEFAULT_LLM_BUDGET: LLMBudget = {
  selfEvalRate: 0.3,
  forceLLMEvalThreshold: 0.35,
  newGenomeInteractions: 5,
};

// ── Length scoring by task type ────────────────────────────────

const LENGTH_EXPECTATIONS: Record<string, { min: number; ideal: number; max: number }> = {
  coding:        { min: 30,  ideal: 400, max: 3000 },
  research:      { min: 50,  ideal: 300, max: 2000 },
  analysis:      { min: 40,  ideal: 350, max: 2500 },
  creative:      { min: 20,  ideal: 250, max: 2000 },
  summarization: { min: 20,  ideal: 150, max: 800 },
  general:       { min: 20,  ideal: 200, max: 1500 },
};

function scoreLengthByTaskType(response: string, taskType: string): number {
  const len = response.length;
  const expect = LENGTH_EXPECTATIONS[taskType] ?? LENGTH_EXPECTATIONS.general;

  if (len < expect.min) return 0.1;
  if (len <= expect.ideal) return 0.5 + 0.5 * ((len - expect.min) / (expect.ideal - expect.min));
  if (len <= expect.max) return 1.0 - 0.3 * ((len - expect.ideal) / (expect.max - expect.ideal));
  return 0.4; // too long
}

// ── Structure scoring ─────────────────────────────────────────

function scoreStructure(response: string, taskType: string): number {
  let score = 0.5;

  // Code blocks present? Very good for coding tasks
  const hasCodeBlock = /```[\s\S]*?```/.test(response);
  if (taskType === 'coding' && hasCodeBlock) score += 0.4;
  if (taskType === 'coding' && !hasCodeBlock && response.length > 100) score -= 0.2;

  // Bullet points/numbered lists? Good for research/analysis
  const hasList = /^\s*[-*\d]+[.)]\s/m.test(response);
  if ((taskType === 'research' || taskType === 'analysis') && hasList) score += 0.2;

  // Paragraphs for creative/summarization
  const paragraphs = response.split(/\n\s*\n/).length;
  if (taskType === 'creative' && paragraphs >= 2) score += 0.15;
  if (taskType === 'summarization' && paragraphs <= 3) score += 0.15;

  // Empty or error-like responses
  if (!response.trim()) return 0;
  if (response.startsWith('Error:') || response.startsWith('I cannot')) return 0.1;

  return Math.max(0, Math.min(1, score));
}

// ── Keyword overlap scoring ───────────────────────────────────

function scoreKeywordOverlap(response: string, taskPrompt: string): number {
  const promptWords = new Set(
    taskPrompt.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3),
  );
  if (promptWords.size === 0) return 0.5;

  const responseWords = new Set(
    response.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3),
  );

  let overlap = 0;
  for (const w of promptWords) {
    if (responseWords.has(w)) overlap++;
  }

  // Some overlap is good (relevance), too much might be parroting
  const ratio = overlap / promptWords.size;
  if (ratio < 0.1) return 0.2;  // barely relevant
  if (ratio < 0.4) return 0.7;  // good relevance
  if (ratio < 0.7) return 0.9;  // strong relevance
  return 0.6; // might be parroting
}

// ── Main local evaluation ─────────────────────────────────────

export function computeLocalEval(
  response: string,
  task: Task,
): LocalEvalResult {
  // Fast-path: empty/error responses
  if (!response || !response.trim() || response.startsWith('Error:')) {
    return { score: 0, confidence: 0.95, method: 'local' };
  }

  const taskType = task.type || 'general';

  const signals = {
    length: scoreLengthByTaskType(response, taskType),
    structure: scoreStructure(response, taskType),
    overlap: scoreKeywordOverlap(response, task.prompt),
  };

  // Weighted combination — structure matters more for coding
  const structureWeight = taskType === 'coding' ? 0.45 : 0.3;
  const overlapWeight = taskType === 'coding' ? 0.25 : 0.4;
  const lengthWeight = 1 - structureWeight - overlapWeight;
  const score = signals.length * lengthWeight + signals.structure * structureWeight + signals.overlap * overlapWeight;

  // Confidence: based on signal agreement
  const values = Object.values(signals);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  const confidence = Math.max(0, Math.min(1, 1 - variance * 3));

  return { score, confidence, method: 'local' };
}

// ── Decision: should we call LLM self-eval? ───────────────────

export function shouldCallLLMEval(
  localResult: LocalEvalResult,
  genomeInteractionCount: number,
  budget: LLMBudget = DEFAULT_LLM_BUDGET,
): boolean {
  // New genomes always get LLM eval to build a baseline
  if (genomeInteractionCount < budget.newGenomeInteractions) return true;

  // Low local score → uncertain, ask LLM
  if (localResult.score < budget.forceLLMEvalThreshold) return true;

  // Low confidence → signals disagree, ask LLM
  if (localResult.confidence < 0.6) return true;

  // Uncertainty zone (neither clearly good nor bad)
  if (localResult.score > 0.35 && localResult.score < 0.65) return true;

  // Budget-based sampling for the rest
  // Use a deterministic-ish check based on score to avoid randomness in tests
  const hash = (localResult.score * 1000 + genomeInteractionCount * 7) % 100;
  return hash < budget.selfEvalRate * 100;
}
