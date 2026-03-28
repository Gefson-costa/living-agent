// ================================================================
//  Constants — Named constants for evolution, fitness, and learning
//
//  Centralizes magic numbers that control agent behavior.
//  Local tuning params (mutation step sizes, scoring weights)
//  remain inline in their respective files.
// ================================================================

// ── Hash normalization ───────────────────────────────────────────

/** Convert hashString() output to 0..1 range */
export const HASH_NORMALIZER = 0xFFFFFFFF;

// ── Reward & Fitness ────────────────────────────────────────────

/** Base reward: (score - center) * scale */
export const BASE_REWARD_CENTER = 0.9;
export const BASE_REWARD_SCALE = 4;

/** Token cost: budget / normalizer * weight */
export const TOKEN_COST_NORMALIZER = 4000;
export const TOKEN_COST_WEIGHT = 0.5;

/** Habitat bonus: if match > threshold, add bonus */
export const HABITAT_MATCH_THRESHOLD = 0.7;
export const HABITAT_BONUS = 0.1;

/** Expertise bonus weight for task assignment */
export const EXPERTISE_BONUS_WEIGHT = 0.2;

/** Discordance penalty: apply when signal stdev exceeds this */
export const DISCORDANCE_STDEV_THRESHOLD = 0.3;

/** Minimum paired experiences before weight calibration kicks in */
export const MIN_CALIBRATION_SAMPLES = 10;

// ── Evolution ───────────────────────────────────────────────────

/** Fitness multiplier per cycle (forces strategies to prove value) */
export const FITNESS_DECAY_RATE = 0.95;

/** Fraction of top strategies eligible for breeding */
export const BREED_TOP_FRACTION = 0.5;

/** Max offspring as fraction of strategy count */
export const BIRTH_TARGET_FRACTION = 0.3;

/** Chance to use a MAP-Elites champion as second parent */
export const MAP_ELITES_CHAMPION_CHANCE = 0.2;

/** Chance to rescue from MAP-Elites instead of breeding */
export const MAP_ELITES_RESCUE_CHANCE = 0.5;

/** Rescue mutations are gentler: rate * this */
export const RESCUE_MUTATION_MULTIPLIER = 0.5;

/** Novelty seed multiplier — Ecology (explore) vs Consolidation (conserve) */
export const NOVELTY_SEED_ECOLOGY = 0.5;
export const NOVELTY_SEED_CONSOLIDATION = 0.3;

/** Min age before a strategy can be culled */
export const MIN_CULL_AGE = 2;

/** Max rescue count per cycle */
export const MAX_RESCUE_COUNT = 6;

/** Min MAP-Elites cells before rescue is possible */
export const MIN_RESCUE_CELLS = 3;

/** Elo draw threshold — scores within this are a tie */
export const ELO_DRAW_THRESHOLD = 0.01;

/** Elo rating spread divisor (standard chess: 400) */
export const ELO_SPREAD = 400;

// ── Reward Learning ─────────────────────────────────────────────

/** Negative deltas hurt 1.2x more (Kahneman-Tversky loss aversion, reduced for exploration) */
export const LOSS_AVERSION = 1.2;

/** Scale factor for fitness delta → reward signal */
export const REWARD_DELTA_SCALE = 8;

/** Reward signal clamp bounds */
export const REWARD_CLAMP_MIN = -0.8;
export const REWARD_CLAMP_MAX = 3.0;

/** Decay-toward-birth rate as fraction of learningRate */
export const BIRTH_DECAY_FRACTION = 0.2;

/** Score threshold: above = reinforce, below = dampen */
export const SCORE_REINFORCE_THRESHOLD = 0.5;

// ── Crossover ───────────────────────────────────────────────────

/** Primary parent weight in scalar gene blending */
export const CROSSOVER_PRIMARY_WEIGHT = 0.6;

/** Max skill refs per genome */
export const MAX_SKILL_REFS = 10;

// ── Genome Creation Bounds ──────────────────────────────────────

export const GENOME_DEFAULTS = {
  mutability: { min: 0.8, max: 1.2 },
  learningRate: { min: 0.003, max: 0.025 },
  lamarckianRate: { min: 0, max: 0.08 },
} as const;

// ── Genome Mutation Bounds ──────────────────────────────────────

export const MUTATION_BOUNDS = {
  mutability: { min: 0.5, max: 2.0 },
  learningRate: { min: 0.001, max: 0.04 },
  lamarckianRate: { min: 0, max: 0.25 },
} as const;
