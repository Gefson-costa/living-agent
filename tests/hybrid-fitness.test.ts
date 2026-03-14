import { describe, it, expect } from 'vitest';
import { computeHybridFitness, calibrateWeights } from '../src/fitness/hybrid-fitness.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import type { FitnessSignal, FitnessWeights } from '../src/core/types.js';

describe('computeHybridFitness', () => {
  it('combines all three signals (engagement null)', () => {
    const signal: FitnessSignal = { completion: 0.8, selfEval: 0.6, userFeedback: 0.9, engagement: null };
    const weights: FitnessWeights = {
      completionWeight: 0.5, selfEvalWeight: 0.2,
      userFeedbackWeight: 0.3, engagementWeight: 0.2, selfEvalAccuracy: 0.5,
    };

    const fitness = computeHybridFitness(signal, weights);
    const expected = (0.8 * 0.5 + 0.6 * 0.2 + 0.9 * 0.3) / (0.5 + 0.2 + 0.3);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  it('handles null completion', () => {
    const signal: FitnessSignal = { completion: null, selfEval: 0.7, userFeedback: 0.8, engagement: null };
    const fitness = computeHybridFitness(signal);
    // Default weights: selfEval=0.1, userFeedback=0.2
    const expected = (0.7 * 0.1 + 0.8 * 0.2) / (0.1 + 0.2);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  it('handles null selfEval', () => {
    const signal: FitnessSignal = { completion: 0.9, selfEval: null, userFeedback: 0.7, engagement: null };
    const fitness = computeHybridFitness(signal);
    // Default weights: completion=0.5, userFeedback=0.2
    const expected = (0.9 * 0.5 + 0.7 * 0.2) / (0.5 + 0.2);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  it('handles null userFeedback', () => {
    const signal: FitnessSignal = { completion: 0.8, selfEval: 0.6, userFeedback: null, engagement: null };
    const fitness = computeHybridFitness(signal);
    // Default weights: completion=0.5, selfEval=0.1
    const expected = (0.8 * 0.5 + 0.6 * 0.1) / (0.5 + 0.1);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  it('handles only completion signal', () => {
    const signal: FitnessSignal = { completion: 0.75, selfEval: null, userFeedback: null, engagement: null };
    const fitness = computeHybridFitness(signal);
    expect(fitness).toBeCloseTo(0.75, 5);
  });

  it('returns 0 when all signals are null', () => {
    const signal: FitnessSignal = { completion: null, selfEval: null, userFeedback: null, engagement: null };
    const fitness = computeHybridFitness(signal);
    expect(fitness).toBe(0);
  });

  it('uses custom weights', () => {
    const signal: FitnessSignal = { completion: 0.7, selfEval: 0.6, userFeedback: null, engagement: null };
    const weights: FitnessWeights = {
      completionWeight: 0.3, selfEvalWeight: 0.7,
      userFeedbackWeight: 0.0, engagementWeight: 0.0, selfEvalAccuracy: 0.5,
    };

    const fitness = computeHybridFitness(signal, weights);
    // stdev of [0.7, 0.6] ≈ 0.05 — no penalty
    const expected = (0.7 * 0.3 + 0.6 * 0.7) / (0.3 + 0.7);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  it('handles perfect scores', () => {
    const signal: FitnessSignal = { completion: 1.0, selfEval: 1.0, userFeedback: 1.0, engagement: null };
    const fitness = computeHybridFitness(signal);
    expect(fitness).toBeCloseTo(1.0, 5);
  });

  it('handles zero scores', () => {
    const signal: FitnessSignal = { completion: 0.0, selfEval: 0.0, userFeedback: 0.0, engagement: null };
    const fitness = computeHybridFitness(signal);
    expect(fitness).toBeCloseTo(0.0, 5);
  });

  // ── 4-signal combination tests ─────────────────────────────

  it('combines all four signals', () => {
    const signal: FitnessSignal = { completion: 0.8, selfEval: 0.6, userFeedback: 0.9, engagement: 0.7 };
    const weights: FitnessWeights = {
      completionWeight: 0.5, selfEvalWeight: 0.1,
      userFeedbackWeight: 0.2, engagementWeight: 0.2, selfEvalAccuracy: 0.5,
    };

    const fitness = computeHybridFitness(signal, weights);
    const expected = (0.8 * 0.5 + 0.6 * 0.1 + 0.9 * 0.2 + 0.7 * 0.2) / (0.5 + 0.1 + 0.2 + 0.2);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  it('engagement-only signal', () => {
    const signal: FitnessSignal = { completion: null, selfEval: null, userFeedback: null, engagement: 0.65 };
    const fitness = computeHybridFitness(signal);
    expect(fitness).toBeCloseTo(0.65, 5);
  });

  it('selfEval + engagement (production case without user feedback)', () => {
    const signal: FitnessSignal = { completion: null, selfEval: 0.7, userFeedback: null, engagement: 0.8 };
    const fitness = computeHybridFitness(signal);
    // Default weights: selfEval=0.1, engagement=0.2
    const expected = (0.7 * 0.1 + 0.8 * 0.2) / (0.1 + 0.2);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  // ── Discordance penalty tests ───────────────────────────────

  it('no penalty when signals are concordant (stdev < 0.3)', () => {
    const signal: FitnessSignal = { completion: 0.7, selfEval: 0.8, userFeedback: 0.75, engagement: null };
    const weights: FitnessWeights = {
      completionWeight: 0.5, selfEvalWeight: 0.2,
      userFeedbackWeight: 0.3, engagementWeight: 0.2, selfEvalAccuracy: 0.5,
    };
    const fitness = computeHybridFitness(signal, weights);
    // stdev of [0.7, 0.8, 0.75] ≈ 0.041 — well below 0.3, no penalty
    const expected = (0.7 * 0.5 + 0.8 * 0.2 + 0.75 * 0.3) / (0.5 + 0.2 + 0.3);
    expect(fitness).toBeCloseTo(expected, 5);
  });

  it('applies penalty when signals are discordant', () => {
    const signal: FitnessSignal = { completion: 0.9, selfEval: 0.2, userFeedback: null, engagement: null };
    const noPenaltyScore = (0.9 * 0.5 + 0.2 * 0.1) / (0.5 + 0.1);
    const fitness = computeHybridFitness(signal);
    // stdev of [0.9, 0.2] = 0.35 → penalty = 1 - (0.35 - 0.3) = 0.95
    expect(fitness).toBeLessThan(noPenaltyScore);
  });

  it('score is never negative after discordance penalty', () => {
    // Extreme discordance: 1.0 vs 0.0
    const signal: FitnessSignal = { completion: 1.0, selfEval: 0.0, userFeedback: null, engagement: null };
    const fitness = computeHybridFitness(signal);
    expect(fitness).toBeGreaterThanOrEqual(0);
    expect(fitness).toBeLessThanOrEqual(1);
  });

  it('no penalty with only 1 signal', () => {
    const signal: FitnessSignal = { completion: 0.8, selfEval: null, userFeedback: null, engagement: null };
    const fitness = computeHybridFitness(signal);
    expect(fitness).toBeCloseTo(0.8, 5);
  });
});

describe('calibrateWeights', () => {
  it('returns defaults with insufficient data', async () => {
    const store = new MemoryStore();
    const weights = await calibrateWeights(store);
    expect(weights.completionWeight).toBe(0.5);
    expect(weights.selfEvalWeight).toBe(0.1);
    expect(weights.userFeedbackWeight).toBe(0.2);
    expect(weights.engagementWeight).toBe(0.2);
  });

  it('adjusts weights with correlated self-eval and feedback', async () => {
    const store = new MemoryStore();

    // Add correlated experiences: selfEval ~ userFeedback
    for (let i = 0; i < 20; i++) {
      const score = i / 20;
      await store.recordExperience({
        strategyId: 's1', taskType: 'math', taskPrompt: '', response: '',
        score, tokensUsed: 100, latencyMs: 50,
        fitnessSignal: score, userFeedback: score + (Math.random() * 0.1 - 0.05),
      });
    }

    const weights = await calibrateWeights(store);
    // High correlation → self-eval weight should remain meaningful
    expect(weights.selfEvalWeight).toBeGreaterThan(0);
    expect(weights.completionWeight).toBeGreaterThan(0);
    expect(weights.userFeedbackWeight).toBeGreaterThan(0);
    expect(weights.engagementWeight).toBe(0.2);
  });
});
