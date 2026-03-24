import { describe, it, expect } from 'vitest';
import { ArchitectureEvolution, CONFIG_BOUNDS } from '../../src/self-coding/arch-evolution.js';
import type { LLMAdapter, LLMConfig, LLMResponse } from '../../src/core/types.js';

// ── Mock LLM ────────────────────────────────────────────────────

class MockArchLLM implements LLMAdapter {
  response: object | null = null;

  async execute(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    if (this.response) {
      return { content: JSON.stringify(this.response), tokensUsed: 100, latencyMs: 50 };
    }
    return { content: '{"proposal": null}', tokensUsed: 50, latencyMs: 50 };
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('ArchitectureEvolution', () => {
  const llm = new MockArchLLM();
  const archEvo = new ArchitectureEvolution(llm);

  const currentConfig = {
    mutationRate: 1.0,
    epsilon: 0.5,
    skillExtractionThreshold: 0.7,
    cullThreshold: 0.3,
    noveltyWeight: 0.5,
    elitismRate: 0.2,
  };

  describe('proposeChanges', () => {
    it('returns a valid proposal when LLM suggests changes', async () => {
      llm.response = {
        proposal: {
          description: 'Increase exploration',
          expectedImpact: 'More diversity',
          configUpdates: { epsilon: 0.6 },
        },
      };

      const proposal = await archEvo.proposeChanges('metrics data', currentConfig);

      expect(proposal).not.toBeNull();
      expect(proposal!.description).toBe('Increase exploration');
      expect(proposal!.status).toBe('proposed');
      expect(proposal!.configUpdates.epsilon).toBe(0.6);
    });

    it('returns null when LLM says no changes needed', async () => {
      llm.response = { proposal: null };

      const proposal = await archEvo.proposeChanges('metrics data', currentConfig);
      expect(proposal).toBeNull();
    });

    it('returns null when a proposal is already being tested', async () => {
      llm.response = {
        proposal: {
          description: 'Test',
          expectedImpact: 'Test',
          configUpdates: { epsilon: 0.6 },
        },
      };

      // First proposal accepted and started testing
      const evo = new ArchitectureEvolution(llm);
      const first = await evo.proposeChanges('metrics', currentConfig);
      expect(first).not.toBeNull();
      evo.startTesting(first!, 0.5);

      // Second proposal should be blocked
      const second = await evo.proposeChanges('metrics', currentConfig);
      expect(second).toBeNull();
    });
  });

  describe('clampUpdates', () => {
    it('clamps values to valid bounds', () => {
      const evo = new ArchitectureEvolution(llm);
      const result = evo.clampUpdates(
        { mutationRate: 10.0 },  // way above max of 2.0
        currentConfig,
      );

      expect(result.mutationRate).toBeLessThanOrEqual(1.3);  // max 30% change from 1.0
    });

    it('enforces max 30% change per cycle', () => {
      const evo = new ArchitectureEvolution(llm);
      const result = evo.clampUpdates(
        { mutationRate: 2.0 },   // 100% increase from 1.0
        currentConfig,
      );

      // Max change from 1.0 is ±0.3 (30%)
      expect(result.mutationRate).toBeLessThanOrEqual(1.3);
      expect(result.mutationRate).toBeGreaterThanOrEqual(0.7);
    });

    it('filters out unknown parameters', () => {
      const evo = new ArchitectureEvolution(llm);
      const result = evo.clampUpdates(
        { unknownParam: 0.5 },
        currentConfig,
      );

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('skips updates that result in no change', () => {
      const evo = new ArchitectureEvolution(llm);
      const result = evo.clampUpdates(
        { epsilon: 0.5 },   // same as current
        currentConfig,
      );

      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('A/B test flow', () => {
    it('accepts proposal when fitness improves above standard margin (+5%)', () => {
      const evo = new ArchitectureEvolution(llm);
      const proposal = {
        id: 'prop_test',
        description: 'Increase epsilon',
        expectedImpact: 'More exploration',
        configUpdates: { epsilon: 0.6 },  // epsilon is not critical
        fitnessBeforeApply: 0,
        fitnessAfterApply: null,
        status: 'proposed' as const,
        timestamp: Date.now(),
        testCyclesRemaining: 5,
      };

      evo.startTesting(proposal, 0.5);
      expect(evo.getActiveProposal()?.status).toBe('testing');

      // Simulate 4 cycles with stable fitness
      for (let i = 0; i < 4; i++) {
        expect(evo.evaluateCycle(0.53)).toBe('continue');
      }

      // 5th cycle: fitness above baseline + 5% margin
      const verdict = evo.evaluateCycle(0.53);
      expect(verdict).toBe('accept');
      expect(evo.getActiveProposal()).toBeNull();
      expect(evo.getHistory()).toHaveLength(1);
      expect(evo.getHistory()[0].status).toBe('accepted');
    });

    it('rejects proposal with critical params when improvement < 15%', () => {
      const evo = new ArchitectureEvolution(llm);
      const proposal = {
        id: 'prop_critical',
        description: 'Change mutation rate',
        expectedImpact: 'Better convergence',
        configUpdates: { mutationRate: 1.2 },  // mutationRate IS critical
        fitnessBeforeApply: 0,
        fitnessAfterApply: null,
        status: 'proposed' as const,
        timestamp: Date.now(),
        testCyclesRemaining: 5,
      };

      evo.startTesting(proposal, 0.5);

      // Simulate 4 cycles
      for (let i = 0; i < 4; i++) {
        evo.evaluateCycle(0.53);
      }

      // 5th cycle: +6% (above standard 5% but below critical 15%)
      const verdict = evo.evaluateCycle(0.53);
      expect(verdict).toBe('reject');
      expect(evo.getHistory().at(-1)?.status).toBe('rejected');
    });

    it('accepts critical params when improvement >= 15%', () => {
      const evo = new ArchitectureEvolution(llm);
      const proposal = {
        id: 'prop_critical_good',
        description: 'Boost mutation',
        expectedImpact: 'Better convergence',
        configUpdates: { mutationRate: 1.2 },
        fitnessBeforeApply: 0,
        fitnessAfterApply: null,
        status: 'proposed' as const,
        timestamp: Date.now(),
        testCyclesRemaining: 5,
      };

      evo.startTesting(proposal, 0.5);

      for (let i = 0; i < 4; i++) {
        evo.evaluateCycle(0.58);
      }

      // +16% improvement
      const verdict = evo.evaluateCycle(0.58);
      expect(verdict).toBe('accept');
    });

    it('early-rejects when fitness drops >20%', () => {
      const evo = new ArchitectureEvolution(llm);
      const proposal = {
        id: 'prop_bad',
        description: 'Bad idea',
        expectedImpact: 'Disaster',
        configUpdates: { epsilon: 0.6 },
        fitnessBeforeApply: 0,
        fitnessAfterApply: null,
        status: 'proposed' as const,
        timestamp: Date.now(),
        testCyclesRemaining: 5,
      };

      evo.startTesting(proposal, 0.5);

      // First cycle: massive fitness drop
      const verdict = evo.evaluateCycle(0.35);  // 30% drop
      expect(verdict).toBe('reject');
      expect(evo.getActiveProposal()).toBeNull();
      expect(evo.getHistory().at(-1)?.status).toBe('rolled-back');
    });
  });

  describe('CONFIG_BOUNDS', () => {
    it('has bounds defined for key parameters', () => {
      expect(CONFIG_BOUNDS).toHaveProperty('mutationRate');
      expect(CONFIG_BOUNDS).toHaveProperty('epsilon');
      expect(CONFIG_BOUNDS).toHaveProperty('cullThreshold');
      expect(CONFIG_BOUNDS.mutationRate.critical).toBe(true);
      expect(CONFIG_BOUNDS.epsilon.critical).toBe(false);
    });
  });
});
