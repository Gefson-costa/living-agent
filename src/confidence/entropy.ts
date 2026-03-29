// ================================================================
//  Vote Entropy & Calibrated Confidence
//
//  Core of Phase 2: transforms raw vote distributions into
//  calibrated confidence signals. The genome evolves the thresholds
//  (T1, T2) that determine when to trust, caveat, or abstain.
// ================================================================

import type {
  ConfidenceLevel, ConfidenceResult, CalibrationBucket,
  CalibrationMetrics, StrategyGenome,
} from '../core/types.js';

// ── Vote Entropy ───────────────────────────────────────────────

/**
 * Shannon entropy of a vote distribution.
 *
 * H = -sum(p_i * ln(p_i)) for p_i > 0
 *
 * Range: 0 (unanimous) to ln(K) where K = number of options with votes.
 * For 4-choice MC: max H = ln(4) ≈ 1.386
 */
export function voteEntropy(votes: number[]): number {
  const total = votes.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  let h = 0;
  for (const count of votes) {
    if (count > 0) {
      const p = count / total;
      h -= p * Math.log(p);
    }
  }
  return h;
}

/** Maximum possible entropy for K options: ln(K) */
export function maxEntropy(optionCount: number): number {
  return optionCount > 1 ? Math.log(optionCount) : 0;
}

/**
 * Normalized entropy: H / ln(K), range 0..1
 * 0 = unanimous, 1 = perfectly uniform
 */
export function normalizedEntropy(votes: number[]): number {
  const k = votes.filter(v => v > 0).length;
  if (k <= 1) return 0;
  const maxH = Math.log(votes.length);
  if (maxH === 0) return 0;
  return voteEntropy(votes) / maxH;
}

// ── Confidence Classification ──────────────────────────────────

/**
 * Classify confidence based on vote entropy and genome thresholds.
 *
 * T1 = confidenceThresholdHigh (low entropy → HIGH confidence)
 * T2 = confidenceThresholdLow  (high entropy → LOW confidence)
 *
 * entropy < T1 → HIGH
 * T1 <= entropy < T2 → MEDIUM
 * entropy >= T2 → LOW
 */
export function classifyConfidence(
  entropy: number,
  thresholdHigh: number,
  thresholdLow: number,
): ConfidenceLevel {
  if (entropy < thresholdHigh) return 'HIGH';
  if (entropy < thresholdLow) return 'MEDIUM';
  return 'LOW';
}

/**
 * Full confidence result from a vote distribution + genome thresholds.
 */
export function evaluateConfidence(
  votes: number[],
  genome: Pick<StrategyGenome, 'confidenceThresholdHigh' | 'confidenceThresholdLow' | 'abstentionPolicy'>,
): ConfidenceResult {
  const total = votes.reduce((a, b) => a + b, 0);
  const entropy = voteEntropy(votes);
  const confidence = classifyConfidence(
    entropy,
    genome.confidenceThresholdHigh,
    genome.confidenceThresholdLow,
  );

  const maxVotes = Math.max(...votes);
  const winner = maxVotes > 0 ? votes.indexOf(maxVotes) : null;
  const abstained = confidence === 'LOW' && genome.abstentionPolicy === 'refuse';

  return {
    answer: abstained ? null : winner,
    confidence,
    entropy,
    voteDistribution: [...votes],
    totalVotes: total,
    abstained,
  };
}

// ── Calibration Metrics ────────────────────────────────────────

export interface ConfidenceResultWithGold {
  result: ConfidenceResult;
  gold: number;  // correct answer index
}

/**
 * Compute calibration metrics from a set of confidence results.
 *
 * This is the core evaluation: how well does the confidence signal
 * predict actual accuracy?
 */
export function computeCalibrationMetrics(
  results: ConfidenceResultWithGold[],
): CalibrationMetrics {
  const total = results.length;
  if (total === 0) {
    return {
      selectiveAccuracy: 0, coverage: 0, abstentionRate: 0,
      falseConfidenceRate: 0, expectedCalibrationError: 0,
      buckets: [], totalQuestions: 0,
    };
  }

  // Build buckets
  const bucketMap = new Map<ConfidenceLevel, { count: number; correct: number }>();
  for (const level of ['HIGH', 'MEDIUM', 'LOW'] as ConfidenceLevel[]) {
    bucketMap.set(level, { count: 0, correct: 0 });
  }

  let answered = 0;
  let answeredCorrect = 0;
  let abstained = 0;

  for (const { result, gold } of results) {
    const bucket = bucketMap.get(result.confidence)!;
    bucket.count++;

    if (result.abstained) {
      abstained++;
      continue;
    }

    answered++;
    if (result.answer === gold) {
      bucket.correct++;
      answeredCorrect++;
    }
  }

  // Build bucket array
  const buckets: CalibrationBucket[] = (['HIGH', 'MEDIUM', 'LOW'] as ConfidenceLevel[]).map(level => {
    const b = bucketMap.get(level)!;
    return {
      confidence: level,
      count: b.count,
      correct: b.correct,
      accuracy: b.count > 0 ? b.correct / b.count : 0,
    };
  });

  // Selective accuracy: accuracy on non-abstained answers
  const selectiveAccuracy = answered > 0 ? answeredCorrect / answered : 0;

  // Coverage: fraction of questions answered
  const coverage = answered / total;

  // Abstention rate
  const abstentionRate = abstained / total;

  // False confidence rate: wrong HIGH-confidence answers / total HIGH-confidence
  const highBucket = bucketMap.get('HIGH')!;
  const highAnswered = highBucket.count - results.filter(
    r => r.result.confidence === 'HIGH' && r.result.abstained
  ).length;
  const falseConfidenceRate = highAnswered > 0
    ? (highAnswered - highBucket.correct) / highAnswered
    : 0;

  // ECE: Expected Calibration Error
  // |accuracy(bucket) - expected_accuracy(bucket)| weighted by bucket size
  // Expected accuracy per level: HIGH=0.85, MEDIUM=0.55, LOW=0.30
  const expectedAccuracy: Record<ConfidenceLevel, number> = {
    HIGH: 0.85,
    MEDIUM: 0.55,
    LOW: 0.30,
  };
  let ece = 0;
  for (const bucket of buckets) {
    if (bucket.count > 0) {
      ece += (bucket.count / total)
        * Math.abs(bucket.accuracy - expectedAccuracy[bucket.confidence]);
    }
  }

  return {
    selectiveAccuracy,
    coverage,
    abstentionRate,
    falseConfidenceRate,
    expectedCalibrationError: ece,
    buckets,
    totalQuestions: total,
  };
}

// ── Calibration Fitness ────────────────────────────────────────

/**
 * Fitness function for calibrated confidence.
 *
 * fitness = selective_accuracy × coverage - penalty × false_confidence_rate
 *
 * This rewards:
 * - High accuracy on accepted answers (selective_accuracy)
 * - Answering as many questions as possible (coverage)
 *
 * This penalizes:
 * - Being wrong when claiming high confidence (false_confidence_rate)
 *
 * The penalty weight is high (default 5.0) because false confidence
 * is the worst failure mode — it destroys trust.
 */
export function calibrationFitness(
  metrics: CalibrationMetrics,
  falseConfidencePenalty = 5.0,
): number {
  const raw = metrics.selectiveAccuracy * metrics.coverage
    - falseConfidencePenalty * metrics.falseConfidenceRate;
  // Clamp to 0..1 range
  return Math.max(0, Math.min(1, raw));
}
