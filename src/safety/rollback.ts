// ================================================================
//  Rollback — Population snapshots and automatic rollback
//
//  Snapshots the strategy population before each consolidation.
//  If fitness degrades >20% over 3 cycles after a self-coding
//  patch, automatically restores the population.
// ================================================================

import type { Strategy, StrategyGenome, StrategyWeights } from '../core/types.js';

export interface PopulationSnapshot {
  id: string;
  label: string;
  timestamp: number;
  avgFitness: number;
  strategies: SerializedStrategy[];
  configState?: SerializedConfigState;
}

export interface SerializedConfigState {
  mutationRate?: number;
  epsilon?: number;
  skillExtractionThreshold?: number;
  cullThreshold?: number;
}

interface SerializedStrategy {
  genome: SerializedGenome;
  fitness: number;
  age: number;
  taskTypeMemory: [string, number][];
}

interface SerializedGenome {
  id: string;
  promptStyle: number[];
  toolPreferences: number[];
  temperature: number;
  maxTokenBudget: number;
  reasoningDepth: number;
  mutability: number;
  learningRate: number;
  lamarckianRate: number;
  habitatPref: number;
  fewShotCount: number;
  promptSegments: string[];
  skillRefs: string[];
}

let snapshotCounter = 0;

export class PopulationRollback {
  private snapshots = new Map<string, PopulationSnapshot>();
  private snapshotOrder: string[] = [];
  private degradationCounter = 0;
  private maxSnapshots: number;

  constructor(maxSnapshots = 20) {
    this.maxSnapshots = maxSnapshots;
  }

  /** Take a snapshot of the current population and active configuration. Returns snapshot ID. */
  snapshot(strategies: Strategy[], label = 'consolidation', configState?: SerializedConfigState): string {
    const id = `snap_${++snapshotCounter}_${Date.now()}`;
    const avgFitness = strategies.length > 0
      ? strategies.reduce((sum, s) => sum + s.fitness, 0) / strategies.length
      : 0;

    const snap: PopulationSnapshot = {
      id,
      label,
      timestamp: Date.now(),
      avgFitness,
      strategies: strategies.map(s => serializeStrategy(s)),
      configState,
    };

    this.snapshots.set(id, snap);
    this.snapshotOrder.push(id);
    this.prune(this.maxSnapshots);

    return id;
  }

  /** Restore strategies and config state from a snapshot. */
  restore(snapshotId: string): { strategies: Strategy[], configState?: SerializedConfigState } | null {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) return null;
    return {
      strategies: snap.strategies.map(s => deserializeStrategy(s)),
      configState: snap.configState,
    };
  }

  /** Get the most recent snapshot */
  getLatestSnapshot(): PopulationSnapshot | null {
    if (this.snapshotOrder.length === 0) return null;
    const id = this.snapshotOrder[this.snapshotOrder.length - 1];
    return this.snapshots.get(id) ?? null;
  }

  /**
   * Check if population fitness has degraded significantly.
   * Returns true if avg fitness dropped >threshold vs the latest snapshot
   * for degradationCycles consecutive checks.
   *
   * @param currentAvgFitness - Current average fitness of population
   * @param threshold - Fraction drop to consider degradation (default 0.20 = 20%)
   * @param degradationCycles - Consecutive cycles of degradation before triggering (default 3)
   */
  checkDegradation(
    currentAvgFitness: number,
    threshold = 0.20,
    degradationCycles = 3,
  ): boolean {
    const latest = this.getLatestSnapshot();
    if (!latest) return false;

    let degraded: boolean;
    if (latest.avgFitness <= 0) {
      // Baseline is zero/negative — use absolute drop instead of ratio.
      // Trigger if current fitness fell below baseline by more than threshold (as absolute).
      degraded = (latest.avgFitness - currentAvgFitness) > threshold;
    } else {
      const drop = (latest.avgFitness - currentAvgFitness) / latest.avgFitness;
      degraded = drop > threshold;
    }

    if (degraded) {
      this.degradationCounter++;
    } else {
      this.degradationCounter = 0;
    }

    return this.degradationCounter >= degradationCycles;
  }

  /** Reset degradation counter (after a successful rollback or recovery) */
  resetDegradation(): void {
    this.degradationCounter = 0;
  }

  /** Keep only the last N snapshots */
  prune(maxSnapshots: number): void {
    while (this.snapshotOrder.length > maxSnapshots) {
      const oldId = this.snapshotOrder.shift()!;
      this.snapshots.delete(oldId);
    }
  }

  /** Number of stored snapshots */
  get size(): number {
    return this.snapshots.size;
  }

  /** Get all snapshot IDs (oldest first) */
  getSnapshotIds(): string[] {
    return [...this.snapshotOrder];
  }
}

// ── Serialization helpers ────────────────────────────────────────

function serializeStrategy(s: Strategy): SerializedStrategy {
  return {
    genome: serializeGenome(s.genome),
    fitness: s.fitness,
    age: s.age,
    taskTypeMemory: [...s.taskTypeMemory.entries()],
  };
}

function serializeGenome(g: StrategyGenome): SerializedGenome {
  return {
    id: g.id,
    promptStyle: Array.from(g.promptStyle),
    toolPreferences: Array.from(g.toolPreferences),
    temperature: g.temperature,
    maxTokenBudget: g.maxTokenBudget,
    reasoningDepth: g.reasoningDepth,
    mutability: g.mutability,
    learningRate: g.learningRate,
    lamarckianRate: g.lamarckianRate,
    habitatPref: g.habitatPref,
    fewShotCount: g.fewShotCount ?? 0,
    promptSegments: [...(g.promptSegments ?? [])],
    skillRefs: [...g.skillRefs],
  };
}

function deserializeStrategy(s: SerializedStrategy): Strategy {
  return {
    genome: deserializeGenome(s.genome),
    fitness: s.fitness,
    age: s.age,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(s.taskTypeMemory),
  };
}

function deserializeGenome(g: SerializedGenome): StrategyGenome {
  return {
    id: g.id,
    promptStyle: new Float32Array(g.promptStyle),
    toolPreferences: new Float32Array(g.toolPreferences),
    temperature: g.temperature,
    maxTokenBudget: g.maxTokenBudget,
    reasoningDepth: g.reasoningDepth,
    mutability: g.mutability,
    learningRate: g.learningRate,
    lamarckianRate: g.lamarckianRate,
    habitatPref: g.habitatPref,
    fewShotCount: g.fewShotCount ?? 0,
    promptSegments: [...(g.promptSegments ?? [])],
    skillRefs: [...g.skillRefs],
    voteCount: (g as any).voteCount ?? 5,
    confidenceThresholdHigh: (g as any).confidenceThresholdHigh ?? 0.3,
    confidenceThresholdLow: (g as any).confidenceThresholdLow ?? 0.8,
    abstentionPolicy: (g as any).abstentionPolicy ?? 'refuse',
  };
}

/** Reset snapshot counter (for tests) */
export function resetSnapshotCounter(): void {
  snapshotCounter = 0;
}
