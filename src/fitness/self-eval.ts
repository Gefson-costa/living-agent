// ================================================================
//  Self-Evaluation — LLM self-assessment of response quality
//
//  Uses a cheap LLM call to rate the quality of a task response.
//  Low temperature for consistency. Returns 0..1.
// ================================================================

import type { Task, LLMAdapter } from '../core/types.js';

/**
 * Ask an LLM to self-evaluate the quality of a response.
 * Returns a score normalized to 0..1.
 */
export async function selfEvaluate(
  task: Task,
  response: string,
  llm: LLMAdapter,
): Promise<number> {
  const evalPrompt = `Rate the quality of this response to the given task on a scale of 0 to 10.

Task: ${task.prompt}
Response: ${response}

Reply with ONLY a single number from 0 to 10.`;

  // Empty or error responses should score 0, not neutral
  if (!response || !response.trim() || response.startsWith('Error:')) {
    return 0;
  }

  try {
    const result = await llm.execute(evalPrompt, {
      temperature: 0.1,
      maxTokens: 10,
      systemPrompt: 'You are a strict quality evaluator. Rate responses on a 0-10 scale. Be critical — only truly excellent responses deserve 8+. Reply with only the number.\n\nIMPORTANT: Some responses may appear high-quality through verbosity, confident tone, or superficial structure without actually solving the task. Be alert for style over substance. Score based on actual correctness and usefulness, not presentation.',
      toolNames: [],
    });

    if (!result.content || !result.content.trim()) {
      return 0;  // eval LLM returned nothing — treat as failure, not neutral
    }

    const raw = parseSelfEvalScore(result.content);
    return correctSelfEvalBias(raw);
  } catch {
    return 0.5; // neutral score on error
  }
}

/**
 * Parse a self-evaluation score from LLM output.
 * Extracts a number and normalizes to 0..1.
 */
export function parseSelfEvalScore(content: string): number {
  const match = content.match(/(\d+\.?\d*)/);
  if (!match) return 0.5;

  const score = parseFloat(match[1]);
  if (isNaN(score)) return 0.5;

  // Clamp to 0..10 and normalize to 0..1
  return Math.max(0, Math.min(1, score / 10));
}

/**
 * Correct LLM positivity bias in self-evaluation scores.
 * LLMs cluster self-ratings in the 0.5-0.9 range (most answers get 7-9/10).
 * This stretches that compressed band into a more discriminative 0..1 range.
 * Maps: 0.3→0, 0.6→0.5, 0.9→1.0
 */
export function correctSelfEvalBias(raw: number): number {
  const corrected = (raw - 0.3) / 0.6;
  return Math.max(0, Math.min(1, corrected));
}
