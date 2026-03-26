// ================================================================
//  Response History — Fingerprint responses via embeddings
//
//  Stores embeddings of high-scoring responses per task type in a
//  ring buffer. Enables three capabilities:
//
//  1. Better local scoring — compare new responses against top
//     historical responses (high similarity → probably good)
//  2. Collapse detection — if a strategy's responses cluster too
//     tightly, it's degenerating (always outputting the same thing)
//  3. Real diversity — measure how different two strategies' outputs
//     actually are, in response space not parameter space
//
//  Ref: ARCHITECTURE_DECISION.md — Point 2: Response Fingerprinting
// ================================================================

import type { Embedder } from './embedder.js';
import { cosineSimilarity, centroid } from './embedder.js';

// ── Config ───────────────────────────────────────────────────────

export interface ResponseHistoryConfig {
  /** Max embeddings stored per task type (ring buffer size). Default 100. */
  maxPerType: number;
  /** Min score to record a response as "good". Default 0.6. */
  qualityThreshold: number;
  /** Variance below this → collapse detected. Default 0.05. */
  collapseThreshold: number;
}

const DEFAULT_CONFIG: ResponseHistoryConfig = {
  maxPerType: 100,
  qualityThreshold: 0.6,
  collapseThreshold: 0.05,
};

// ── Per-type ring buffer entry ───────────────────────────────────

interface TypeBuffer {
  embeddings: Float32Array[];
  scores: number[];
  writeIdx: number;
  centroid: Float32Array | null;
}

// ── Per-strategy response tracking (for collapse detection) ──────

interface StrategyResponseLog {
  recentEmbeddings: Float32Array[];
  writeIdx: number;
}

const STRATEGY_LOG_SIZE = 20; // track last 20 responses per strategy

// ── ResponseHistory ──────────────────────────────────────────────

export class ResponseHistory {
  private embedder: Embedder;
  private config: ResponseHistoryConfig;

  // Task type → ring buffer of top response embeddings
  private typeBuffers = new Map<string, TypeBuffer>();

  // Strategy ID → recent response embeddings (for collapse detection)
  private strategyLogs = new Map<string, StrategyResponseLog>();

  constructor(embedder: Embedder, config: Partial<ResponseHistoryConfig> = {}) {
    this.embedder = embedder;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Record a response ────────────────────────────────────────

  /**
   * Record a response for a task type. Only stores if score >= qualityThreshold.
   * Also tracks per-strategy responses for collapse detection.
   */
  async record(
    taskType: string,
    strategyId: string,
    response: string,
    score: number,
  ): Promise<void> {
    const embedding = await this.embedder.embed(response);

    // Always track per-strategy (even bad responses — collapse = always same output)
    this.recordStrategyResponse(strategyId, embedding);

    // Only store high-quality responses in type buffer
    if (score < this.config.qualityThreshold) return;

    let buffer = this.typeBuffers.get(taskType);
    if (!buffer) {
      buffer = { embeddings: [], scores: [], writeIdx: 0, centroid: null };
      this.typeBuffers.set(taskType, buffer);
    }

    if (buffer.embeddings.length < this.config.maxPerType) {
      buffer.embeddings.push(embedding);
      buffer.scores.push(score);
    } else {
      buffer.embeddings[buffer.writeIdx] = embedding;
      buffer.scores[buffer.writeIdx] = score;
      buffer.writeIdx = (buffer.writeIdx + 1) % this.config.maxPerType;
    }

    // Update centroid incrementally
    if (!buffer.centroid) {
      buffer.centroid = embedding;
    } else {
      const count = Math.min(buffer.embeddings.length, this.config.maxPerType);
      buffer.centroid = centroid(buffer.embeddings.slice(0, count));
    }
  }

  private recordStrategyResponse(strategyId: string, embedding: Float32Array): void {
    let log = this.strategyLogs.get(strategyId);
    if (!log) {
      log = { recentEmbeddings: [], writeIdx: 0 };
      this.strategyLogs.set(strategyId, log);
    }

    if (log.recentEmbeddings.length < STRATEGY_LOG_SIZE) {
      log.recentEmbeddings.push(embedding);
    } else {
      log.recentEmbeddings[log.writeIdx] = embedding;
      log.writeIdx = (log.writeIdx + 1) % STRATEGY_LOG_SIZE;
    }
  }

  // ── Similarity to top responses ──────────────────────────────

  /**
   * Compare a response against historically good responses for this task type.
   * Returns 0..1 (1 = very similar to past successes).
   * Returns null if no history exists for this task type.
   */
  async similarityToTop(
    taskType: string,
    response: string,
  ): Promise<number | null> {
    const buffer = this.typeBuffers.get(taskType);
    if (!buffer || buffer.embeddings.length < 3) return null; // need minimum history

    const embedding = await this.embedder.embed(response);

    // Compare against centroid (fast aggregate comparison)
    if (buffer.centroid) {
      const sim = cosineSimilarity(embedding, buffer.centroid);
      // Map [-1, 1] → [0, 1]
      return (sim + 1) / 2;
    }

    return null;
  }

  /**
   * Compare a pre-computed embedding against history for a task type.
   * Avoids re-embedding when the caller already has the vector.
   */
  similarityToTopFromEmbedding(
    taskType: string,
    embedding: Float32Array,
  ): number | null {
    const buffer = this.typeBuffers.get(taskType);
    if (!buffer || buffer.embeddings.length < 3 || !buffer.centroid) return null;

    const sim = cosineSimilarity(embedding, buffer.centroid);
    return (sim + 1) / 2;
  }

  // ── Collapse Detection ───────────────────────────────────────

  /**
   * Detect if a strategy is collapsing (producing the same output repeatedly).
   * Returns { collapsed: boolean, variance: number }.
   * Needs at least 5 responses to make a judgment.
   */
  detectCollapse(strategyId: string): { collapsed: boolean; variance: number } | null {
    const log = this.strategyLogs.get(strategyId);
    if (!log || log.recentEmbeddings.length < 5) return null;

    // Compute mean pairwise cosine similarity
    const embs = log.recentEmbeddings;
    let totalSim = 0;
    let pairs = 0;

    for (let i = 0; i < embs.length; i++) {
      for (let j = i + 1; j < embs.length; j++) {
        totalSim += cosineSimilarity(embs[i], embs[j]);
        pairs++;
      }
    }

    const meanSim = pairs > 0 ? totalSim / pairs : 0;

    // Variance = 1 - meanSimilarity (high similarity → low variance → collapse)
    const variance = 1 - meanSim;

    return {
      collapsed: variance < this.config.collapseThreshold,
      variance,
    };
  }

  // ── Diversity Measurement ────────────────────────────────────

  /**
   * Measure output diversity between two strategies.
   * Returns 0..1 (0 = identical outputs, 1 = completely different).
   * Returns null if either strategy has insufficient data.
   */
  outputDiversity(strategyA: string, strategyB: string): number | null {
    const logA = this.strategyLogs.get(strategyA);
    const logB = this.strategyLogs.get(strategyB);

    if (!logA || logA.recentEmbeddings.length < 3) return null;
    if (!logB || logB.recentEmbeddings.length < 3) return null;

    const centroidA = centroid(logA.recentEmbeddings);
    const centroidB = centroid(logB.recentEmbeddings);

    const sim = cosineSimilarity(centroidA, centroidB);
    // Map similarity to diversity: 1 (identical) → 0 diversity, -1 (opposite) → 1 diversity
    return (1 - sim) / 2;
  }

  // ── Accessors ────────────────────────────────────────────────

  /** Check if we have enough history for a task type. */
  hasHistory(taskType: string): boolean {
    const buffer = this.typeBuffers.get(taskType);
    return !!buffer && buffer.embeddings.length >= 3;
  }

  /** Number of recorded responses for a task type. */
  getCount(taskType: string): number {
    return this.typeBuffers.get(taskType)?.embeddings.length ?? 0;
  }

  /** Number of strategies being tracked for collapse. */
  get trackedStrategies(): number {
    return this.strategyLogs.size;
  }

  /** Get all task types with history. */
  get taskTypes(): string[] {
    return [...this.typeBuffers.keys()];
  }

  /** Get the underlying embedder (for reusing embeddings). */
  getEmbedder(): Embedder {
    return this.embedder;
  }
}
