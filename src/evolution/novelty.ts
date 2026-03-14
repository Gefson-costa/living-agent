// ================================================================
//  Novelty Archive — Open-Ended Evolution Pressure
//
//  Rewards behavioral NOVELTY — strategies that behave differently
//  from the historical record get a reproduction bonus.
// ================================================================

import type { StrategyBehavior, Strategy } from '../core/types.js';
import { MAX_ARCHIVE, NOVELTY_K } from '../core/types.js';

export class NoveltyArchive {
  private archive: StrategyBehavior[] = [];
  private replaceIdx = 0;

  /** Compute behavior descriptor from a strategy's recent task history */
  static describe(strategy: Strategy): StrategyBehavior {
    const history = strategy.taskHistory;
    if (history.length === 0) {
      return { successRate: 0, taskDiversity: 0, toolEntropy: 0, avgTokenEfficiency: 0, learningMagnitude: 0 };
    }

    // Success rate
    const successes = history.filter(t => t.success).length;
    const successRate = successes / history.length;

    // Task diversity: unique task types / total tasks
    const taskTypes = new Set(history.map(t => t.taskType));
    const taskDiversity = Math.min(1, taskTypes.size / Math.max(1, history.length));

    // Tool entropy: score variance as proxy for tool usage diversity
    const scores = history.map(t => t.score);
    const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    let variance = 0;
    for (const s of scores) variance += (s - meanScore) * (s - meanScore);
    const toolEntropy = Math.min(1, Math.sqrt(variance / scores.length));

    // Token efficiency: average score per token (normalized)
    let totalEff = 0;
    for (const t of history) {
      totalEff += t.tokensUsed > 0 ? t.score / (t.tokensUsed / 1000) : 0;
    }
    const avgTokenEfficiency = Math.min(1, totalEff / history.length);

    // Learning magnitude: how much strategy has changed from birth
    let learningMagnitude = 0;
    if (strategy.birthWeights) {
      let sum = 0;
      const style = strategy.genome.promptStyle;
      const birthStyle = strategy.birthWeights.promptStyle;
      for (let i = 0; i < style.length; i++) {
        sum += Math.abs(style[i] - birthStyle[i]);
      }
      learningMagnitude = style.length > 0 ? sum / style.length : 0;
    }

    return { successRate, taskDiversity, toolEntropy, avgTokenEfficiency, learningMagnitude };
  }

  /** Euclidean distance between two descriptors */
  private dist(a: StrategyBehavior, b: StrategyBehavior): number {
    const ds = (a.successRate - b.successRate) * 2;
    const dt = (a.taskDiversity - b.taskDiversity) * 1.5;
    const de = (a.toolEntropy - b.toolEntropy) * 1.5;
    const da = (a.avgTokenEfficiency - b.avgTokenEfficiency) * 1.2;
    const dl = (a.learningMagnitude - b.learningMagnitude) * 1.3;
    return Math.sqrt(ds * ds + dt * dt + de * de + da * da + dl * dl);
  }

  /** Compute novelty score: mean distance to K nearest neighbors */
  novelty(desc: StrategyBehavior): number {
    if (this.archive.length < NOVELTY_K) return 1;

    const dists: number[] = [];
    for (let i = 0; i < this.archive.length; i++) {
      dists.push(this.dist(desc, this.archive[i]));
    }
    dists.sort((a, b) => a - b);

    let sum = 0;
    const k = Math.min(NOVELTY_K, dists.length);
    for (let i = 0; i < k; i++) sum += dists[i];
    return sum / k;
  }

  /** Add a descriptor to the archive (ring buffer) */
  add(desc: StrategyBehavior): void {
    if (this.archive.length < MAX_ARCHIVE) {
      this.archive.push(desc);
    } else {
      this.archive[this.replaceIdx] = desc;
      this.replaceIdx = (this.replaceIdx + 1) % MAX_ARCHIVE;
    }
  }

  /** Median novelty for normalization */
  get medianNovelty(): number {
    if (this.archive.length < NOVELTY_K * 2) return 0.5;
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const idx = (Math.random() * this.archive.length) | 0;
      samples.push(this.novelty(this.archive[idx]));
    }
    samples.sort((a, b) => a - b);
    return samples[10];
  }

  get size(): number {
    return this.archive.length;
  }
}
