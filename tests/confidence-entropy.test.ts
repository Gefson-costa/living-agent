import { describe, it, expect } from 'vitest';
import {
  voteEntropy, normalizedEntropy, maxEntropy,
  classifyConfidence, evaluateConfidence,
  computeCalibrationMetrics, calibrationFitness,
} from '../src/confidence/entropy.js';
import type { ConfidenceResultWithGold } from '../src/confidence/entropy.js';

describe('voteEntropy', () => {
  it('returns 0 for unanimous votes', () => {
    expect(voteEntropy([5, 0, 0, 0])).toBe(0);
    expect(voteEntropy([0, 0, 7, 0])).toBe(0);
  });

  it('returns max entropy for uniform distribution', () => {
    const h = voteEntropy([5, 5, 5, 5]);
    expect(h).toBeCloseTo(Math.log(4), 5);
  });

  it('returns intermediate value for split votes', () => {
    const h = voteEntropy([4, 1, 0, 0]);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(Math.log(4));
  });

  it('returns 0 for empty votes', () => {
    expect(voteEntropy([0, 0, 0, 0])).toBe(0);
  });

  it('handles 2-way split', () => {
    const h = voteEntropy([3, 3, 0, 0]);
    expect(h).toBeCloseTo(Math.log(2), 5); // ln(2) for 50/50
  });
});

describe('normalizedEntropy', () => {
  it('returns 0 for unanimous', () => {
    expect(normalizedEntropy([5, 0, 0, 0])).toBe(0);
  });

  it('returns 1 for uniform', () => {
    expect(normalizedEntropy([5, 5, 5, 5])).toBeCloseTo(1, 5);
  });
});

describe('maxEntropy', () => {
  it('returns ln(K) for K options', () => {
    expect(maxEntropy(4)).toBeCloseTo(Math.log(4));
    expect(maxEntropy(2)).toBeCloseTo(Math.log(2));
  });

  it('returns 0 for 1 or fewer', () => {
    expect(maxEntropy(1)).toBe(0);
    expect(maxEntropy(0)).toBe(0);
  });
});

describe('classifyConfidence', () => {
  it('classifies low entropy as HIGH', () => {
    expect(classifyConfidence(0.1, 0.3, 0.8)).toBe('HIGH');
  });

  it('classifies medium entropy as MEDIUM', () => {
    expect(classifyConfidence(0.5, 0.3, 0.8)).toBe('MEDIUM');
  });

  it('classifies high entropy as LOW', () => {
    expect(classifyConfidence(1.0, 0.3, 0.8)).toBe('LOW');
  });

  it('boundary: exactly T1 is MEDIUM', () => {
    expect(classifyConfidence(0.3, 0.3, 0.8)).toBe('MEDIUM');
  });

  it('boundary: exactly T2 is LOW', () => {
    expect(classifyConfidence(0.8, 0.3, 0.8)).toBe('LOW');
  });
});

describe('evaluateConfidence', () => {
  const genome = {
    confidenceThresholdHigh: 0.3,
    confidenceThresholdLow: 0.8,
    abstentionPolicy: 'refuse' as const,
  };

  it('unanimous votes → HIGH confidence, not abstained', () => {
    const result = evaluateConfidence([5, 0, 0, 0], genome);
    expect(result.confidence).toBe('HIGH');
    expect(result.answer).toBe(0);
    expect(result.abstained).toBe(false);
    expect(result.entropy).toBe(0);
  });

  it('split votes → LOW confidence, abstained with refuse policy', () => {
    const result = evaluateConfidence([2, 1, 1, 1], genome);
    expect(result.confidence).toBe('LOW');
    expect(result.abstained).toBe(true);
    expect(result.answer).toBe(null);
  });

  it('split votes → LOW confidence, NOT abstained with caveat policy', () => {
    const caveatGenome = { ...genome, abstentionPolicy: 'caveat' as const };
    const result = evaluateConfidence([2, 1, 1, 1], caveatGenome);
    expect(result.confidence).toBe('LOW');
    expect(result.abstained).toBe(false);
    expect(result.answer).toBe(0); // majority still wins
  });

  it('4/5 majority → MEDIUM confidence', () => {
    const result = evaluateConfidence([4, 1, 0, 0], genome);
    expect(result.confidence).toBe('MEDIUM');
    expect(result.answer).toBe(0);
    expect(result.abstained).toBe(false);
  });

  it('includes vote distribution', () => {
    const result = evaluateConfidence([3, 1, 1, 0], genome);
    expect(result.voteDistribution).toEqual([3, 1, 1, 0]);
    expect(result.totalVotes).toBe(5);
  });
});

describe('computeCalibrationMetrics', () => {
  it('returns zeros for empty input', () => {
    const m = computeCalibrationMetrics([]);
    expect(m.selectiveAccuracy).toBe(0);
    expect(m.coverage).toBe(0);
    expect(m.totalQuestions).toBe(0);
  });

  it('computes perfect calibration', () => {
    // All HIGH confidence, all correct
    const results: ConfidenceResultWithGold[] = Array.from({ length: 10 }, (_, i) => ({
      result: {
        answer: 0,
        confidence: 'HIGH' as const,
        entropy: 0,
        voteDistribution: [5, 0, 0, 0],
        totalVotes: 5,
        abstained: false,
      },
      gold: 0,
    }));

    const m = computeCalibrationMetrics(results);
    expect(m.selectiveAccuracy).toBe(1);
    expect(m.coverage).toBe(1);
    expect(m.abstentionRate).toBe(0);
    expect(m.falseConfidenceRate).toBe(0);
  });

  it('computes abstention correctly', () => {
    const results: ConfidenceResultWithGold[] = [
      // 3 answered correctly with HIGH confidence
      ...Array.from({ length: 3 }, () => ({
        result: { answer: 0, confidence: 'HIGH' as const, entropy: 0, voteDistribution: [5, 0, 0, 0], totalVotes: 5, abstained: false },
        gold: 0,
      })),
      // 2 abstained
      ...Array.from({ length: 2 }, () => ({
        result: { answer: null, confidence: 'LOW' as const, entropy: 1.2, voteDistribution: [2, 1, 1, 1], totalVotes: 5, abstained: true },
        gold: 1,
      })),
    ];

    const m = computeCalibrationMetrics(results);
    expect(m.selectiveAccuracy).toBe(1);    // 3/3 correct among answered
    expect(m.coverage).toBe(3 / 5);          // 3 out of 5 answered
    expect(m.abstentionRate).toBe(2 / 5);    // 2 out of 5 abstained
    expect(m.falseConfidenceRate).toBe(0);   // no wrong HIGH answers
  });

  it('computes false confidence rate', () => {
    const results: ConfidenceResultWithGold[] = [
      // 8 correct with HIGH confidence
      ...Array.from({ length: 8 }, () => ({
        result: { answer: 0, confidence: 'HIGH' as const, entropy: 0, voteDistribution: [5, 0, 0, 0], totalVotes: 5, abstained: false },
        gold: 0,
      })),
      // 2 WRONG with HIGH confidence (false confidence!)
      ...Array.from({ length: 2 }, () => ({
        result: { answer: 1, confidence: 'HIGH' as const, entropy: 0.1, voteDistribution: [0, 5, 0, 0], totalVotes: 5, abstained: false },
        gold: 0,
      })),
    ];

    const m = computeCalibrationMetrics(results);
    expect(m.falseConfidenceRate).toBe(0.2); // 2/10 HIGH were wrong
    expect(m.selectiveAccuracy).toBe(0.8);   // 8/10 correct
  });

  it('bucket accuracy reflects per-level performance', () => {
    const results: ConfidenceResultWithGold[] = [
      // 5 HIGH, 4 correct
      ...Array.from({ length: 4 }, () => ({
        result: { answer: 0, confidence: 'HIGH' as const, entropy: 0, voteDistribution: [5, 0, 0, 0], totalVotes: 5, abstained: false },
        gold: 0,
      })),
      {
        result: { answer: 1, confidence: 'HIGH' as const, entropy: 0.1, voteDistribution: [0, 5, 0, 0], totalVotes: 5, abstained: false },
        gold: 0,
      },
      // 3 MEDIUM, 1 correct
      {
        result: { answer: 0, confidence: 'MEDIUM' as const, entropy: 0.5, voteDistribution: [3, 2, 0, 0], totalVotes: 5, abstained: false },
        gold: 0,
      },
      ...Array.from({ length: 2 }, () => ({
        result: { answer: 1, confidence: 'MEDIUM' as const, entropy: 0.6, voteDistribution: [2, 3, 0, 0], totalVotes: 5, abstained: false },
        gold: 0,
      })),
    ];

    const m = computeCalibrationMetrics(results);
    const high = m.buckets.find(b => b.confidence === 'HIGH')!;
    const med = m.buckets.find(b => b.confidence === 'MEDIUM')!;
    expect(high.accuracy).toBe(4 / 5);
    expect(med.accuracy).toBeCloseTo(1 / 3);
  });
});

describe('calibrationFitness', () => {
  it('perfect calibration gives high fitness', () => {
    const f = calibrationFitness({
      selectiveAccuracy: 0.9,
      coverage: 0.8,
      abstentionRate: 0.2,
      falseConfidenceRate: 0,
      expectedCalibrationError: 0.05,
      buckets: [],
      totalQuestions: 100,
    });
    expect(f).toBeCloseTo(0.72); // 0.9 * 0.8 = 0.72
  });

  it('false confidence is heavily penalized', () => {
    const f = calibrationFitness({
      selectiveAccuracy: 0.9,
      coverage: 0.8,
      abstentionRate: 0.2,
      falseConfidenceRate: 0.2, // 20% false confidence
      expectedCalibrationError: 0.1,
      buckets: [],
      totalQuestions: 100,
    });
    // 0.9 * 0.8 - 5.0 * 0.2 = 0.72 - 1.0 = -0.28 → clamped to 0
    expect(f).toBe(0);
  });

  it('zero coverage gives zero fitness', () => {
    const f = calibrationFitness({
      selectiveAccuracy: 1.0,
      coverage: 0,
      abstentionRate: 1.0,
      falseConfidenceRate: 0,
      expectedCalibrationError: 0,
      buckets: [],
      totalQuestions: 100,
    });
    expect(f).toBe(0);
  });

  it('clamps to 0..1', () => {
    const f = calibrationFitness({
      selectiveAccuracy: 1.0,
      coverage: 1.0,
      abstentionRate: 0,
      falseConfidenceRate: 0,
      expectedCalibrationError: 0,
      buckets: [],
      totalQuestions: 100,
    });
    expect(f).toBe(1);
  });
});
