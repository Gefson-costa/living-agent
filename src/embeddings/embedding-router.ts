// ================================================================
//  Embedding Router — Route tasks to strategies by vector similarity
//
//  Each strategy maintains a centroid embedding of tasks it solved
//  well. New tasks are routed to the strategy whose centroid is
//  most similar, with exploration via softmax temperature.
//
//  This replaces the keyword-based habitat matching with semantic
//  understanding: "Write a Python sorter" and "Code a sorting
//  algorithm in JS" route to the same strategy.
// ================================================================

import type { Strategy } from '../core/types.js';
import type { Embedder } from './embedder.js';
import { cosineSimilarity, updateCentroid } from './embedder.js';

// ── Strategy Embedding Profile ────────────────────────────────

export interface StrategyProfile {
  strategyId: string;
  centroid: Float32Array;       // mean embedding of successful tasks
  taskCount: number;            // number of tasks used to build centroid
  successCount: number;         // tasks where score > threshold
}

export class EmbeddingRouter {
  private profiles = new Map<string, StrategyProfile>();
  private embedder: Embedder;
  private successThreshold: number;

  constructor(embedder: Embedder, successThreshold = 0.5) {
    this.embedder = embedder;
    this.successThreshold = successThreshold;
  }

  /**
   * Record a completed task for a strategy.
   * Updates the strategy's embedding centroid if the task was successful.
   */
  async recordTask(
    strategyId: string,
    taskPrompt: string,
    score: number,
  ): Promise<void> {
    if (score < this.successThreshold) return;
    const embedding = await this.embedder.embed(taskPrompt);
    this.recordTaskFromEmbedding(strategyId, embedding, score);
  }

  /**
   * Record a completed task using a pre-computed embedding (avoids re-embedding).
   */
  recordTaskFromEmbedding(
    strategyId: string,
    embedding: Float32Array,
    score: number,
  ): void {
    if (score < this.successThreshold) return;

    const existing = this.profiles.get(strategyId);

    if (!existing) {
      this.profiles.set(strategyId, {
        strategyId,
        centroid: embedding,
        taskCount: 1,
        successCount: 1,
      });
    } else {
      existing.centroid = updateCentroid(existing.centroid, embedding, existing.taskCount);
      existing.taskCount++;
      existing.successCount++;
    }
  }

  /**
   * Score strategies for a task using embedding similarity.
   * Returns a map of strategyId → similarity score (0..1).
   */
  async scoreStrategies(
    taskPrompt: string,
    strategies: Strategy[],
  ): Promise<Map<string, number>> {
    const taskEmbedding = await this.embedder.embed(taskPrompt);
    return this.scoreStrategiesFromEmbedding(taskEmbedding, strategies);
  }

  /**
   * Score strategies using a pre-computed task embedding (avoids re-embedding).
   */
  scoreStrategiesFromEmbedding(
    taskEmbedding: Float32Array,
    strategies: Strategy[],
  ): Map<string, number> {
    const scores = new Map<string, number>();

    for (const strategy of strategies) {
      const profile = this.profiles.get(strategy.genome.id);
      if (!profile || profile.taskCount === 0) {
        // No history — neutral score (encourages exploration)
        scores.set(strategy.genome.id, 0.5);
        continue;
      }
      const sim = cosineSimilarity(taskEmbedding, profile.centroid);
      // Map from [-1,1] to [0,1]
      scores.set(strategy.genome.id, (sim + 1) / 2);
    }

    return scores;
  }

  /**
   * Select the best strategy for a task using embedding similarity.
   * Combines embedding score with existing fitness/expertise signals.
   */
  async selectBest(
    taskPrompt: string,
    strategies: Strategy[],
    embeddingWeight = 0.4,
  ): Promise<{ strategy: Strategy; embeddingScore: number }> {
    if (strategies.length === 0) {
      throw new Error('Cannot select from empty strategy pool');
    }
    if (strategies.length === 1) {
      return { strategy: strategies[0], embeddingScore: 0.5 };
    }

    const embScores = await this.scoreStrategies(taskPrompt, strategies);

    let best = strategies[0];
    let bestScore = -Infinity;
    let bestEmbScore = 0;

    for (const strategy of strategies) {
      const embScore = embScores.get(strategy.genome.id) ?? 0.5;
      const fitness = Math.max(0, Math.min(1, strategy.fitness));

      // Combined score: embedding similarity + fitness
      const combined = embScore * embeddingWeight + fitness * (1 - embeddingWeight);

      if (combined > bestScore) {
        bestScore = combined;
        best = strategy;
        bestEmbScore = embScore;
      }
    }

    return { strategy: best, embeddingScore: bestEmbScore };
  }

  /** Get profile for a strategy (for debugging/logging). */
  getProfile(strategyId: string): StrategyProfile | undefined {
    return this.profiles.get(strategyId);
  }

  /** Get all profiles. */
  getAllProfiles(): StrategyProfile[] {
    return [...this.profiles.values()];
  }

  /** Check if the router has any data. */
  get hasData(): boolean {
    return this.profiles.size > 0;
  }
}
