// ================================================================
//  Strategy Selector — Epsilon-greedy multi-criteria selection
//
//  Selects the best strategy for a given task type, balancing
//  exploitation (expertise + fitness) with exploration (epsilon).
// ================================================================

import type { Strategy } from '../core/types.js';
import type { TaskType } from './interaction.js';
import { hashString } from '../core/utils.js';
import { NoveltyArchive } from '../evolution/novelty.js';

export interface SelectionConfig {
  epsilon: number;              // exploration probability (default 0.15)
  expertiseWeight: number;      // weight for task-type expertise (default 0.30)
  fitnessWeight: number;        // weight for overall fitness (default 0.30)
  recencyWeight: number;        // weight for recency bonus (default 0.15)
  habitatWeight: number;        // weight for habitat preference match (default 0.15)
  noveltyWeight: number;        // weight for novelty bonus (default 0.10)
}

const DEFAULT_CONFIG: SelectionConfig = {
  epsilon: 0.15,
  expertiseWeight: 0.30,
  fitnessWeight: 0.30,
  recencyWeight: 0.15,
  habitatWeight: 0.15,
  noveltyWeight: 0.10,
};

/**
 * Score a strategy for a specific task type.
 * Combines task-type expertise, overall fitness, and recency.
 */
export function scoreStrategy(
  strategy: Strategy,
  taskType: TaskType,
  config: SelectionConfig = DEFAULT_CONFIG,
  noveltyArchive?: NoveltyArchive,
): number {
  // Task-type expertise (from taskTypeMemory)
  const expertise = strategy.taskTypeMemory.get(taskType) ?? 0.5;

  // Overall fitness (normalized: assume 0..1 range)
  const fitness = Math.max(0, Math.min(1, strategy.fitness));

  // Recency: prefer strategies that haven't been used recently
  // Inverse of age gives new strategies a slight bonus
  const recency = strategy.taskHistory.length === 0
    ? 0.7
    : 1 / (1 + strategy.taskHistory.length * 0.1);

  // Habitat match: how well the strategy's habitatPref aligns with the task type hash
  const taskHash = hashString(taskType) / 0xFFFFFFFF;
  const habitatMatch = 1 - Math.abs(strategy.genome.habitatPref - taskHash);

  // Novelty bonus: prefer strategies that are behaviorally diverse
  let noveltyBonus = 0;
  if (noveltyArchive) {
    const desc = NoveltyArchive.describe(strategy);
    noveltyBonus = noveltyArchive.novelty(desc);
  }

  return (
    expertise * config.expertiseWeight +
    fitness * config.fitnessWeight +
    recency * config.recencyWeight +
    habitatMatch * config.habitatWeight +
    noveltyBonus * config.noveltyWeight
  );
}

/**
 * Select a strategy using epsilon-greedy policy.
 * With probability epsilon: random strategy (exploration).
 * With probability 1-epsilon: best-scoring strategy (exploitation).
 */
export function selectStrategy(
  strategies: Strategy[],
  taskType: TaskType,
  config: Partial<SelectionConfig> = {},
  noveltyArchive?: NoveltyArchive,
): Strategy {
  if (strategies.length === 0) {
    throw new Error('Cannot select from empty strategy pool');
  }

  if (strategies.length === 1) {
    return strategies[0];
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Epsilon-greedy: explore
  if (Math.random() < cfg.epsilon) {
    return strategies[Math.floor(Math.random() * strategies.length)];
  }

  // Exploit: pick the highest scoring strategy
  let best = strategies[0];
  let bestScore = scoreStrategy(strategies[0], taskType, cfg, noveltyArchive);

  for (let i = 1; i < strategies.length; i++) {
    const score = scoreStrategy(strategies[i], taskType, cfg, noveltyArchive);
    if (score > bestScore) {
      bestScore = score;
      best = strategies[i];
    }
  }

  return best;
}
