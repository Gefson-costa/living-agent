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
import { EloTracker } from './elo-tracker.js';
import { decayTaskTypeMemory } from '../learning/task-memory.js';

// ── Fitness Decay ───────────────────────────────────────────────

/** Age-dependent fitness decay: offspring get a grace period, veterans get full decay. */
export function applyFitnessDecay(strategies: Strategy[], rate = FITNESS_DECAY_RATE): void {
  const decayAmount = 1 - rate;
  for (const s of strategies) {
    const ageMultiplier = Math.min(1.0, s.age / 5); // ramp up over 5 cycles
    s.fitness *= 1 - decayAmount * ageMultiplier;
  }
}

// ── Parent Selection ────────────────────────────────────────────

/**
 * Tournament selection (size 3) weighted by fitness + Elo rating.
 * Falls back to uniform random when no EloTracker is provided.
 */
export function selectParents(topStrategies: Strategy[], eloTracker?: EloTracker): { parent1: Strategy; parent2: Strategy } {
  if (topStrategies.length === 0) {
    throw new Error('selectParents requires at least 1 strategy');
  }
  if (topStrategies.length === 1) {
    return { parent1: topStrategies[0], parent2: topStrategies[0] };
  }

  const tournamentPick = (exclude?: Strategy): Strategy => {
    const pool = exclude ? topStrategies.filter(s => s !== exclude) : topStrategies;
    if (pool.length === 0) return topStrategies[0]; // fallback
    let best = pool[Math.floor(Math.random() * pool.length)];
    let bestScore = best.fitness + (eloTracker ? eloTracker.getRating(best.genome.id) / 3000 : 0);
    for (let t = 0; t < 2; t++) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      const score = candidate.fitness + (eloTracker ? eloTracker.getRating(candidate.genome.id) / 3000 : 0);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  };

  const parent1 = tournamentPick();
  const parent2 = tournamentPick(parent1);
  return { parent1, parent2 };
}

// ── Breed Offspring ─────────────────────────────────────────────

/** Crossover two genomes then mutate the result. */
export function breedOffspring(
  genome1: StrategyGenome,
  genome2: StrategyGenome,
  mutationRate: number,
  config: AgentConfig,
  fitness1?: number,
  fitness2?: number,
): StrategyGenome {
  const base = crossoverGenomes(genome1, genome2, config, Math.random, fitness1, fitness2);
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
