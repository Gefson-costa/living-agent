// ================================================================
//  Architecture Evolution — Agent self-modification of config
//
//  Proposes changes to the agent's own configuration parameters
//  based on performance metrics. Includes bounds validation,
//  A/B test tracking, and automatic rollback on fitness drop.
//
//  Flow: analyze → propose → apply (A/B test) → accept/reject
//  Safety: no gene changes >30%/cycle, rollback if fitness -20%,
//  critical params require +15% margin to accept.
// ================================================================

import type { LLMAdapter, ArchitectureProposal } from '../core/types.js';

/** Defines valid range and criticality for each config parameter. */
export interface ConfigBounds {
  min: number;
  max: number;
  maxChangePerCycle: number;   // max fractional change (0.3 = 30%)
  critical: boolean;           // critical params need +15% margin
}

/** Default bounds for known config parameters. */
export const CONFIG_BOUNDS: Record<string, ConfigBounds> = {
  mutationRate:               { min: 0.1,  max: 2.0,  maxChangePerCycle: 0.3, critical: true },
  epsilon:                    { min: 0.0,  max: 1.0,  maxChangePerCycle: 0.3, critical: false },
  skillExtractionThreshold:   { min: 0.0,  max: 1.0,  maxChangePerCycle: 0.3, critical: false },
  cullThreshold:              { min: 0.0,  max: 1.0,  maxChangePerCycle: 0.3, critical: true },
  noveltyWeight:              { min: 0.0,  max: 1.0,  maxChangePerCycle: 0.3, critical: false },
  elitismRate:                { min: 0.0,  max: 1.0,  maxChangePerCycle: 0.3, critical: true },
};

/** Margin required for A/B test acceptance. */
const STANDARD_MARGIN = 0.05;   // +5% for normal params
const CRITICAL_MARGIN = 0.15;   // +15% for critical params

/** Default number of cycles for A/B test before decision. */
const DEFAULT_TEST_CYCLES = 5;

export class ArchitectureEvolution {
  private llm: LLMAdapter;
  private activeProposal: ArchitectureProposal | null = null;
  private history: ArchitectureProposal[] = [];

  constructor(llm: LLMAdapter) {
    this.llm = llm;
  }

  /** Get the currently active (testing) proposal, if any. */
  getActiveProposal(): ArchitectureProposal | null {
    return this.activeProposal;
  }

  /** Get full proposal history. */
  getHistory(): readonly ArchitectureProposal[] {
    return this.history;
  }

  /**
   * Propose changes to the agent's config based on recent metrics.
   * Returns null if LLM determines no changes needed, or if a proposal
   * is already being tested.
   */
  async proposeChanges(
    metricsData: string,
    currentConfig: Record<string, number>,
  ): Promise<ArchitectureProposal | null> {
    // Don't propose while another proposal is being tested
    if (this.activeProposal?.status === 'testing') return null;

    const prompt = `Review the following performance metrics and audit logs for the Living Agent:

${metricsData}

Current configuration:
${Object.entries(currentConfig).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

As an AI architect, your goal is to improve the agent's global configuration to adapt to these metrics.
You may propose changes to parameters like:
- "mutationRate": increase if stuck in local optima (range: 0.1 to 2.0)
- "epsilon": increase for more exploration (range: 0.0 to 1.0)
- "skillExtractionThreshold": lower if agent is not learning skills (range: 0.0 to 1.0)
- "cullThreshold": lower to keep more diversity (range: 0.0 to 1.0)

CONSTRAINTS:
- Each parameter change must be within 30% of current value
- Propose only 1-3 critical modifications
- If the current config seems optimal, respond with {"proposal": null}

Response format MUST be a strict JSON object:
{
  "proposal": {
    "description": "Why we are making these changes",
    "expectedImpact": "Expected effect on fitness/behavior",
    "configUpdates": {
      "mutationRate": 1.5
    }
  }
}`;

    const response = await this.llm.execute(prompt, {
      temperature: 0.3,
      maxTokens: 2000,
      systemPrompt: 'You are an AI architect modifying your own system parameters to maximize long-term fitness.',
      toolNames: [],
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const data = JSON.parse(jsonMatch[0]);
      if (!data.proposal || !data.proposal.configUpdates) return null;

      const rawUpdates = data.proposal.configUpdates as Record<string, number>;
      if (Object.keys(rawUpdates).length === 0) return null;

      // Validate and clamp all proposed values
      const clampedUpdates = this.clampUpdates(rawUpdates, currentConfig);
      if (Object.keys(clampedUpdates).length === 0) return null;

      const proposal: ArchitectureProposal = {
        id: `prop_${Date.now()}`,
        description: data.proposal.description ?? '',
        expectedImpact: data.proposal.expectedImpact ?? '',
        configUpdates: clampedUpdates,
        fitnessBeforeApply: 0,    // set when applied
        fitnessAfterApply: null,
        status: 'proposed',
        timestamp: Date.now(),
        testCyclesRemaining: DEFAULT_TEST_CYCLES,
      };

      return proposal;
    } catch {
      return null;
    }
  }

  /**
   * Start A/B testing a proposal. Sets it as active and records baseline fitness.
   * Returns the clamped config updates to apply.
   */
  startTesting(proposal: ArchitectureProposal, currentAvgFitness: number): Record<string, number> {
    proposal.fitnessBeforeApply = currentAvgFitness;
    proposal.status = 'testing';
    proposal.testCyclesRemaining = DEFAULT_TEST_CYCLES;
    this.activeProposal = proposal;
    return proposal.configUpdates;
  }

  /**
   * Called each consolidation cycle while a proposal is being tested.
   * Returns 'continue' if more cycles needed, 'accept' or 'reject' when decided.
   */
  evaluateCycle(currentAvgFitness: number): 'continue' | 'accept' | 'reject' {
    if (!this.activeProposal || this.activeProposal.status !== 'testing') return 'continue';

    this.activeProposal.testCyclesRemaining--;
    this.activeProposal.fitnessAfterApply = currentAvgFitness;

    // Early rejection: fitness dropped >20%
    const baseline = this.activeProposal.fitnessBeforeApply;
    if (baseline > 0 && currentAvgFitness < baseline * 0.8) {
      this.activeProposal.status = 'rolled-back';
      this.history.push(this.activeProposal);
      this.activeProposal = null;
      return 'reject';
    }

    // Continue if more test cycles remain
    if (this.activeProposal.testCyclesRemaining > 0) return 'continue';

    // Decision time: check if improvement exceeds required margin
    const hasCritical = Object.keys(this.activeProposal.configUpdates)
      .some(key => CONFIG_BOUNDS[key]?.critical ?? false);
    const requiredMargin = hasCritical ? CRITICAL_MARGIN : STANDARD_MARGIN;

    if (baseline > 0 && currentAvgFitness >= baseline * (1 + requiredMargin)) {
      this.activeProposal.status = 'accepted';
      this.history.push(this.activeProposal);
      this.activeProposal = null;
      return 'accept';
    } else {
      this.activeProposal.status = 'rejected';
      this.history.push(this.activeProposal);
      this.activeProposal = null;
      return 'reject';
    }
  }

  /**
   * Clamp proposed updates to valid bounds and max change per cycle.
   * Filters out unknown parameters and invalid changes.
   */
  clampUpdates(
    proposed: Record<string, number>,
    current: Record<string, number>,
  ): Record<string, number> {
    const result: Record<string, number> = {};

    for (const [key, newValue] of Object.entries(proposed)) {
      if (typeof newValue !== 'number' || isNaN(newValue)) continue;

      const bounds = CONFIG_BOUNDS[key];
      if (!bounds) continue;  // unknown parameter — skip

      const currentValue = current[key];
      if (currentValue === undefined) continue;

      // Clamp to valid range
      let clamped = Math.max(bounds.min, Math.min(bounds.max, newValue));

      // Enforce max change per cycle (30%)
      if (currentValue > 0) {
        const maxDelta = currentValue * bounds.maxChangePerCycle;
        clamped = Math.max(currentValue - maxDelta, Math.min(currentValue + maxDelta, clamped));
      }

      // Only include if actually different
      if (Math.abs(clamped - currentValue) > 1e-6) {
        result[key] = Math.round(clamped * 1000) / 1000;  // round to 3 decimals
      }
    }

    return result;
  }
}
