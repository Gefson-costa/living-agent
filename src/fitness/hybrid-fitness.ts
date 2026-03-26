// ================================================================
//  Hybrid Fitness — Multi-signal fitness evaluation
//
//  Combines completion score, LLM self-evaluation, and user feedback
//  with dynamically calibrated weights.
// ================================================================

import type { FitnessSignal, FitnessWeights, StorageAdapter } from '../core/types.js';
import { DISCORDANCE_STDEV_THRESHOLD, MIN_CALIBRATION_SAMPLES } from '../core/constants.js';

const DEFAULT_WEIGHTS: FitnessWeights = {
  completionWeight: 0.5,
  selfEvalWeight: 0.1,
  userFeedbackWeight: 0.2,
  engagementWeight: 0.2,
  selfEvalAccuracy: 0.5,
};

/**
 * Compute hybrid fitness from multiple signals.
 * Null signals are skipped and remaining weights renormalized.
 */
export function computeHybridFitness(
  signal: FitnessSignal,
  weights: FitnessWeights = DEFAULT_WEIGHTS,
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  if (signal.completion !== null) {
    weightedSum += signal.completion * weights.completionWeight;
    totalWeight += weights.completionWeight;
  }

  if (signal.selfEval !== null) {
    weightedSum += signal.selfEval * weights.selfEvalWeight;
    totalWeight += weights.selfEvalWeight;
  }

  if (signal.userFeedback !== null) {
    weightedSum += signal.userFeedback * weights.userFeedbackWeight;
    totalWeight += weights.userFeedbackWeight;
  }

  if (signal.engagement !== null) {
    weightedSum += signal.engagement * weights.engagementWeight;
    totalWeight += weights.engagementWeight;
  }

  if (totalWeight === 0) return 0;
  let score = weightedSum / totalWeight;

  // Discordance penalty: when signals diverge significantly, penalize
  const values: number[] = [];
  if (signal.completion !== null) values.push(signal.completion);
  if (signal.selfEval !== null) values.push(signal.selfEval);
  if (signal.userFeedback !== null) values.push(signal.userFeedback);
  if (signal.engagement !== null) values.push(signal.engagement);

  if (values.length >= 2) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    const stdev = Math.sqrt(variance);
    if (stdev > DISCORDANCE_STDEV_THRESHOLD) {
      score *= 1 - (stdev - DISCORDANCE_STDEV_THRESHOLD);
    }
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Calibrate fitness weights based on historical correlation between
 * self-eval and user feedback. Low correlation → reduce self-eval weight.
 */
export async function calibrateWeights(
  store: StorageAdapter,
): Promise<FitnessWeights> {
  const experiences = await store.queryExperiences({});

  // Find experiences where both self-eval and user feedback exist
  const paired = experiences.filter(e =>
    e.fitnessSignal !== undefined && e.fitnessSignal !== null &&
    e.userFeedback !== undefined && e.userFeedback !== null,
  );

  if (paired.length < MIN_CALIBRATION_SAMPLES) {
    return { ...DEFAULT_WEIGHTS };
  }

  // Compute Pearson correlation between selfEval and userFeedback
  const selfEvals = paired.map(e => e.fitnessSignal!);
  const userFeedbacks = paired.map(e => e.userFeedback!);
  const n = paired.length;

  const meanSE = selfEvals.reduce((a, b) => a + b, 0) / n;
  const meanUF = userFeedbacks.reduce((a, b) => a + b, 0) / n;

  let covSEUF = 0;
  let varSE = 0;
  let varUF = 0;

  for (let i = 0; i < n; i++) {
    const dSE = selfEvals[i] - meanSE;
    const dUF = userFeedbacks[i] - meanUF;
    covSEUF += dSE * dUF;
    varSE += dSE * dSE;
    varUF += dUF * dUF;
  }

  const denom = Math.sqrt(varSE * varUF);
  const correlation = denom > 0 ? covSEUF / denom : 0;

  // Calibration: scale self-eval weight by correlation
  const selfEvalAccuracy = Math.max(0, Math.min(1, (correlation + 1) / 2)); // map -1..1 → 0..1

  // Redistribute weights based on calibration
  // Base self-eval weight is 0.1; when accuracy drops, redistribute proportionally
  const baseSelfEval = 0.1 * selfEvalAccuracy;
  const redistributed = 0.1 * (1 - selfEvalAccuracy);
  const completionWeight = 0.6 + redistributed * (0.6 / 0.9);   // ~67% of surplus
  const userFeedbackWeight = 0.3 + redistributed * (0.3 / 0.9); // ~33% of surplus

  return {
    completionWeight,
    selfEvalWeight: baseSelfEval,
    userFeedbackWeight,
    engagementWeight: 0.2,
    selfEvalAccuracy,
  };
}
