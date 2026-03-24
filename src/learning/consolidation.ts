// ================================================================
//  Consolidation — Periodic "sleep" cycle for strategy evolution
//
//  Ranks strategies, adapts the middle tier, replaces the bottom,
//  distills principles, extracts skills, and prunes the library.
// ================================================================

import type { Strategy, AgentConfig } from '../core/types.js';
import { MapElites } from '../evolution/map-elites.js';
import { NoveltyArchive } from '../evolution/novelty.js';
import type { EloTracker } from '../evolution/elo-tracker.js';
import {
  selectParents,
  breedOffspring,
  createOffspringStrategy,
  computeNoveltySeed,
  rescueFromElites,
} from '../evolution/evolution-engine.js';
import { rewardModulatedUpdate, decayTowardBirth, lamarckianTransfer } from './reward-learning.js';

export interface ConsolidationConfig {
  eliteFraction: number;      // top fraction kept unchanged (default 0.25)
  replaceFraction: number;    // bottom fraction replaced (default 0.25)
  learningCycles: number;     // reward-modulated updates per middle strategy (default 3)
}

const DEFAULT_CONFIG: ConsolidationConfig = {
  eliteFraction: 0.25,
  replaceFraction: 0.25,
  learningCycles: 5,
};

export interface ConsolidationResult {
  eliteCount: number;
  adaptedCount: number;
  replacedCount: number;
  totalLearningDelta: number;
}

/**
 * Run a consolidation cycle over the strategy population.
 * Returns statistics about what changed.
 */
export function consolidate(
  strategies: Strategy[],
  agentConfig: AgentConfig,
  mapElites: MapElites,
  config: Partial<ConsolidationConfig> = {},
  noveltyArchive?: NoveltyArchive,
  eloTracker?: EloTracker,
): ConsolidationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const n = strategies.length;
  if (n <= 1) return { eliteCount: n, adaptedCount: 0, replacedCount: 0, totalLearningDelta: 0 };

  // Sort by fitness (descending), using Elo as tiebreaker
  strategies.sort((a, b) => {
    const diff = b.fitness - a.fitness;
    if (Math.abs(diff) > 0.01 || !eloTracker) return diff;
    return eloTracker.getRating(b.genome.id) - eloTracker.getRating(a.genome.id);
  });

  const eliteCount = Math.max(1, Math.floor(n * cfg.eliteFraction));
  const replaceCount = Math.max(0, Math.floor(n * cfg.replaceFraction));
  const adaptStart = eliteCount;
  const adaptEnd = n - replaceCount;

  let totalLearningDelta = 0;

  // 1. Top fraction: elite — keep unchanged
  // (no action needed)

  // 2. Middle fraction: adapt via reward-modulated learning + decay
  for (let i = adaptStart; i < adaptEnd; i++) {
    const strategy = strategies[i];
    const prevFitness = strategy.fitness;

    for (let c = 0; c < cfg.learningCycles; c++) {
      rewardModulatedUpdate(strategy, prevFitness);
      decayTowardBirth(strategy);
    }

    // Measure learning magnitude
    if (strategy.birthWeights) {
      let sum = 0;
      for (let j = 0; j < strategy.genome.promptStyle.length; j++) {
        sum += Math.abs(strategy.genome.promptStyle[j] - strategy.birthWeights.promptStyle[j]);
      }
      totalLearningDelta += sum;
    }
  }

  // 3. Bottom fraction: replace with offspring from top strategies
  const topStrategies = strategies.slice(0, Math.max(2, eliteCount));

  for (let i = n - replaceCount; i < n; i++) {
    const { parent1, parent2 } = selectParents(topStrategies);

    const childGenome = breedOffspring(parent1.genome, parent2.genome, agentConfig.mutationRate, agentConfig);
    lamarckianTransfer(parent1, childGenome);

    // Try to inject a MAP-Elites champion instead (50% chance)
    const useChampion = Math.random() < 0.5;
    if (useChampion) {
      const rescued = rescueFromElites({
        mapElites, mutationRate: agentConfig.mutationRate, config: agentConfig,
        noveltyArchive, noveltyWeight: agentConfig.noveltyWeight, noveltyMultiplier: 0.3,
      });
      if (rescued) {
        strategies[i] = rescued;
        continue;
      }
    }

    const noveltySeed = computeNoveltySeed(childGenome, noveltyArchive, agentConfig.noveltyWeight, 0.3);
    strategies[i] = createOffspringStrategy({ genome: childGenome, noveltySeed });
  }

  return {
    eliteCount,
    adaptedCount: Math.max(0, adaptEnd - adaptStart),
    replacedCount: replaceCount,
    totalLearningDelta,
  };
}

