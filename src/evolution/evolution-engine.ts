// ================================================================
//  Evolution Engine — Shared evolutionary primitives
//
//  Pure functions used by Ecology (batch), Consolidation (sleep),
//  and LivingAgent (interactive) to avoid duplication.
// ================================================================

import type { Strategy, StrategyGenome, AgentConfig } from '../core/types.js';
import { FITNESS_DECAY_RATE, NOVELTY_SEED_ECOLOGY, RESCUE_MUTATION_MULTIPLIER } from '../core/constants.js';
import { mutateGenome, crossoverGenomes } from './genome.js';
import { NoveltyArchive } from './novelty.js';
import { MapElites } from './map-elites.js';
import { decayTaskTypeMemory } from '../learning/task-memory.js';

// ── Fitness Decay ───────────────────────────────────────────────

/** Multiply every strategy's fitness by `rate` (default 0.95). */
export function applyFitnessDecay(strategies: Strategy[], rate = FITNESS_DECAY_RATE): void {
  for (const s of strategies) {
    s.fitness *= rate;
  }
}

// ── Parent Selection ────────────────────────────────────────────

/**
 * Pick two distinct parents at random from `topStrategies`.
 * If the random draw picks the same strategy twice, shift to the next one.
 * With a single strategy, breeds with itself (self-crossover).
 * Throws only if the pool is completely empty.
 */
export function selectParents(topStrategies: Strategy[]): { parent1: Strategy; parent2: Strategy } {
  if (topStrategies.length === 0) {
    throw new Error('selectParents requires at least 1 strategy');
  }
  if (topStrategies.length === 1) {
    return { parent1: topStrategies[0], parent2: topStrategies[0] };
  }
  const parent1 = topStrategies[Math.floor(Math.random() * topStrategies.length)];
  let parent2 = topStrategies[Math.floor(Math.random() * topStrategies.length)];
  if (parent2 === parent1) {
    parent2 = topStrategies[(topStrategies.indexOf(parent1) + 1) % topStrategies.length];
  }
  return { parent1, parent2 };
}

// ── Breed Offspring ─────────────────────────────────────────────

/** Crossover two genomes then mutate the result. */
export function breedOffspring(
  genome1: StrategyGenome,
  genome2: StrategyGenome,
  mutationRate: number,
  config: AgentConfig,
): StrategyGenome {
  const base = crossoverGenomes(genome1, genome2, config);
  return mutateGenome(base, mutationRate, config);
}

// ── Create Offspring Strategy ───────────────────────────────────

export interface OffspringOptions {
  genome: StrategyGenome;
  noveltySeed?: number;
}

/**
 * Build a fresh Strategy from a genome.
 * age=0, empty taskHistory, automatic birthWeights snapshot.
 */
export function createOffspringStrategy(opts: OffspringOptions): Strategy {
  const strategy: Strategy = {
    genome: opts.genome,
    fitness: opts.noveltySeed ?? 0,
    age: 0,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(),
  };
  // Snapshot birth weights inline (same as snapshotBirthWeights)
  strategy.birthWeights = {
    promptStyle: new Float32Array(strategy.genome.promptStyle),
    toolPreferences: new Float32Array(strategy.genome.toolPreferences),
  };
  return strategy;
}

// ── Compute Novelty Seed ────────────────────────────────────────

/**
 * Compute a small initial fitness seed from novelty.
 * Returns 0 when no archive is provided.
 * `multiplier` defaults to 0.5 (Ecology uses 0.5, Consolidation uses 0.3).
 */
export function computeNoveltySeed(
  genome: StrategyGenome,
  noveltyArchive: NoveltyArchive | undefined,
  noveltyWeight: number,
  multiplier = NOVELTY_SEED_ECOLOGY,
): number {
  if (!noveltyArchive) return 0;
  const tempStrategy: Strategy = {
    genome,
    fitness: 0,
    age: 0,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(),
  };
  const desc = NoveltyArchive.describe(tempStrategy);
  const noveltyScore = noveltyArchive.novelty(desc);
  return noveltyScore * noveltyWeight * multiplier;
}

// ── Rescue from MAP-Elites ──────────────────────────────────────

export interface RescueOptions {
  mapElites: MapElites;
  mutationRate: number;
  config: AgentConfig;
  noveltyArchive?: NoveltyArchive;
  noveltyWeight?: number;
  noveltyMultiplier?: number;
}

/**
 * Pull a champion from MAP-Elites, mutate it at half rate,
 * and return a fresh offspring Strategy. Returns null if no champion available.
 */
export function rescueFromElites(opts: RescueOptions): Strategy | null {
  const champion = opts.mapElites.getRandomChampion();
  if (!champion) return null;

  const rescueGenome = mutateGenome(champion, opts.mutationRate * RESCUE_MUTATION_MULTIPLIER, opts.config);
  const noveltySeed = (opts.noveltyArchive && opts.noveltyWeight !== undefined)
    ? computeNoveltySeed(rescueGenome, opts.noveltyArchive, opts.noveltyWeight, opts.noveltyMultiplier)
    : 0;
  return createOffspringStrategy({ genome: rescueGenome, noveltySeed });
}

// ── Task Memory Decay ───────────────────────────────────────────

/** Apply task-type memory decay to every strategy. */
export function applyTaskMemoryDecay(strategies: Strategy[]): void {
  for (const s of strategies) {
    decayTaskTypeMemory(s);
  }
}
