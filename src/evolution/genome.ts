// ================================================================
//  Genome — create, mutate, crossover, distance
//
//  Adapted from SwarmCore's genome.ts — removes agent social genes,
//  adds reasoningDepth for strategy configuration spaces.
// ================================================================

import type { StrategyGenome, AgentConfig } from '../core/types.js';
import {
  CROSSOVER_PRIMARY_WEIGHT, MAX_SKILL_REFS,
  GENOME_DEFAULTS, MUTATION_BOUNDS,
} from '../core/constants.js';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

let genomeCounter = 0;

function nextId(): string {
  return `strat_${++genomeCounter}`;
}

export function resetGenomeCounter(): void {
  genomeCounter = 0;
}

// ── Create ──────────────────────────────────────────────────────

export function createGenome(
  config: AgentConfig,
  rng: () => number = Math.random,
): StrategyGenome {
  const promptStyle = new Float32Array(config.promptStyleDim);
  for (let i = 0; i < promptStyle.length; i++) {
    promptStyle[i] = (rng() - 0.5) * 2; // -1..1
  }

  const toolPreferences = new Float32Array(config.toolCount);
  for (let i = 0; i < toolPreferences.length; i++) {
    toolPreferences[i] = rng(); // 0..1
  }

  const maxTemp = config.maxTemperature ?? 1.0;
  const maxTokens = config.maxTokenCeiling ?? 4096;
  const local = config.localMode === true;

  return {
    id: nextId(),
    promptStyle,
    toolPreferences,
    temperature: local
      ? 0.1 + rng() * Math.min(0.4, maxTemp - 0.1)   // local: 0.1..0.5
      : 0.1 + rng() * (maxTemp - 0.1),                // default: 0.1..1.0
    maxTokenBudget: local
      ? 800 + (rng() * Math.min(maxTokens - 800, 1700)) | 0  // local: 800..2500 (thinking needs ~500)
      : 200 + (rng() * (maxTokens - 200)) | 0,               // default: 200..4000
    reasoningDepth: local
      ? rng() * 0.5                                    // local: 0..0.5 (less CoT)
      : rng(),                                         // default: 0..1
    mutability: GENOME_DEFAULTS.mutability.min + rng() * (GENOME_DEFAULTS.mutability.max - GENOME_DEFAULTS.mutability.min),
    learningRate: GENOME_DEFAULTS.learningRate.min + rng() * (GENOME_DEFAULTS.learningRate.max - GENOME_DEFAULTS.learningRate.min),
    lamarckianRate: rng() * GENOME_DEFAULTS.lamarckianRate.max,
    habitatPref: rng(),                           // 0..1
    skillRefs: [],
  };
}

// ── Mutate ──────────────────────────────────────────────────────

export function mutateGenome(
  parent: StrategyGenome,
  mutRate: number,
  config: AgentConfig,
  rng: () => number = Math.random,
): StrategyGenome {
  const rate = mutRate * (config.enableAdaptiveMutability !== false ? parent.mutability : 1.0);

  // Mutate promptStyle (gaussian perturbation)
  const promptStyle = new Float32Array(parent.promptStyle);
  for (let i = 0; i < promptStyle.length; i++) {
    if (rng() < 0.15 * rate) {
      promptStyle[i] = clamp(promptStyle[i] + (rng() - 0.5) * 0.3, -1, 1);
    }
  }

  // Mutate toolPreferences
  const toolPreferences = new Float32Array(parent.toolPreferences);
  for (let i = 0; i < toolPreferences.length; i++) {
    if (rng() < 0.15 * rate) {
      toolPreferences[i] = clamp(toolPreferences[i] + (rng() - 0.5) * 0.2, 0, 1);
    }
  }

  // Scalar mutations (respect local mode constraints)
  const maxTemp = config.maxTemperature ?? 1.0;
  const maxTokens = config.maxTokenCeiling ?? 4096;
  const local = config.localMode === true;

  let temperature = parent.temperature;
  if (rng() < 0.12 * rate) temperature = clamp(
    temperature + (rng() - 0.5) * (local ? 0.15 : 0.3),
    0.0,
    local ? Math.min(0.5, maxTemp) : maxTemp,
  );

  let maxTokenBudget = parent.maxTokenBudget;
  if (rng() < 0.10 * rate) maxTokenBudget = clamp(
    maxTokenBudget + ((rng() - 0.5) * (local ? 300 : 500)) | 0,
    local ? 800 : 100,
    local ? Math.min(2500, maxTokens) : maxTokens,
  );

  let reasoningDepth = parent.reasoningDepth;
  if (rng() < 0.12 * rate) reasoningDepth = clamp(
    reasoningDepth + (rng() - 0.5) * (local ? 0.1 : 0.2),
    0,
    local ? 0.5 : 1,
  );

  let mutability = parent.mutability;
  if (rng() < 0.08 * rate) mutability = clamp(mutability + (rng() - 0.5) * 0.2, MUTATION_BOUNDS.mutability.min, MUTATION_BOUNDS.mutability.max);

  let learningRate = parent.learningRate;
  if (rng() < 0.12 * rate) learningRate = clamp(learningRate + (rng() - 0.5) * 0.006, MUTATION_BOUNDS.learningRate.min, MUTATION_BOUNDS.learningRate.max);

  let habitatPref = parent.habitatPref;
  if (rng() < 0.08 * rate) habitatPref = clamp(habitatPref + (rng() - 0.5) * 0.15, 0, 1);

  let lamarckianRate = parent.lamarckianRate;
  if (rng() < 0.08 * rate) lamarckianRate = clamp(lamarckianRate + (rng() - 0.5) * 0.04, MUTATION_BOUNDS.lamarckianRate.min, MUTATION_BOUNDS.lamarckianRate.max);

  // Mutate skillRefs: small chance to drop a skill (pruning dead weight)
  const skillRefs = parent.skillRefs.filter(() => rng() > 0.05 * rate);

  return {
    id: nextId(),
    promptStyle,
    toolPreferences,
    temperature,
    maxTokenBudget,
    reasoningDepth,
    mutability,
    learningRate,
    lamarckianRate,
    habitatPref,
    skillRefs,
  };
}

// ── Crossover ───────────────────────────────────────────────────

export function crossoverGenomes(
  primary: StrategyGenome,
  mate: StrategyGenome,
  config: AgentConfig,
  rng: () => number = Math.random,
): StrategyGenome {
  // Float arrays: uniform crossover per element
  const promptStyle = new Float32Array(config.promptStyleDim);
  for (let i = 0; i < promptStyle.length; i++) {
    promptStyle[i] = rng() < 0.5 ? primary.promptStyle[i] : mate.promptStyle[i];
  }

  const toolPreferences = new Float32Array(config.toolCount);
  for (let i = 0; i < toolPreferences.length; i++) {
    toolPreferences[i] = rng() < 0.5 ? primary.toolPreferences[i] : mate.toolPreferences[i];
  }

  // Scalars: weighted blend (primary 60%, mate 40%)
  const w = CROSSOVER_PRIMARY_WEIGHT;

  // Merge skill refs: deduplicated union, capped at 10
  // Primary parent's skills get priority when over cap
  const skillSet = new Set([...primary.skillRefs, ...mate.skillRefs]);
  let skillRefs = [...skillSet];
  if (skillRefs.length > MAX_SKILL_REFS) {
    // Keep primary's skills first, then fill from mate
    const primarySet = new Set(primary.skillRefs);
    skillRefs.sort((a, b) => (primarySet.has(b) ? 1 : 0) - (primarySet.has(a) ? 1 : 0));
    skillRefs = skillRefs.slice(0, MAX_SKILL_REFS);
  }

  return {
    id: nextId(),
    promptStyle,
    toolPreferences,
    temperature: Math.min(1.0, primary.temperature * w + mate.temperature * (1 - w)),
    maxTokenBudget: Math.round(primary.maxTokenBudget * w + mate.maxTokenBudget * (1 - w)),
    reasoningDepth: primary.reasoningDepth * w + mate.reasoningDepth * (1 - w),
    mutability: primary.mutability * w + mate.mutability * (1 - w),
    learningRate: primary.learningRate * w + mate.learningRate * (1 - w),
    lamarckianRate: primary.lamarckianRate * w + mate.lamarckianRate * (1 - w),
    habitatPref: primary.habitatPref * w + mate.habitatPref * (1 - w),
    skillRefs,
  };
}

// ── Genetic Distance ────────────────────────────────────────────

export function geneticDistance(a: StrategyGenome, b: StrategyGenome): number {
  // PromptStyle distance (sampled for speed)
  let styleSum = 0;
  let styleCount = 0;
  const step = Math.max(1, (a.promptStyle.length / 20) | 0);
  for (let i = 0; i < a.promptStyle.length; i += step) {
    const d = a.promptStyle[i] - b.promptStyle[i];
    styleSum += d * d;
    styleCount++;
  }
  const styleDist = styleCount > 0 ? Math.sqrt(styleSum / styleCount) / 2 : 0;

  // Tool preference distance
  let toolSum = 0;
  for (let i = 0; i < a.toolPreferences.length; i++) {
    const d = a.toolPreferences[i] - b.toolPreferences[i];
    toolSum += d * d;
  }
  const toolDist = a.toolPreferences.length > 0
    ? Math.sqrt(toolSum / a.toolPreferences.length)
    : 0;

  // Scalar distances (normalized)
  const tempDist = Math.abs(a.temperature - b.temperature) / 1.0;
  const tokenDist = Math.abs(a.maxTokenBudget - b.maxTokenBudget) / 4000;
  const habDist = Math.abs(a.habitatPref - b.habitatPref);
  const reasonDist = Math.abs(a.reasoningDepth - b.reasoningDepth);

  // Skill distance: 1 - Jaccard similarity of skillRef sets
  const aSkills = new Set(a.skillRefs);
  const bSkills = new Set(b.skillRefs);
  const union = new Set([...aSkills, ...bSkills]);
  const intersection = [...aSkills].filter(s => bSkills.has(s)).length;
  const skillDist = union.size > 0 ? 1 - intersection / union.size : 0;

  return clamp(
    styleDist * 0.24 +
    toolDist * 0.18 +
    tempDist * 0.13 +
    tokenDist * 0.08 +
    habDist * 0.10 +
    reasonDist * 0.13 +
    skillDist * 0.14,
    0, 1,
  );
}

// ── Clone ───────────────────────────────────────────────────────

export function cloneGenome(g: StrategyGenome): StrategyGenome {
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
    skillRefs: [...g.skillRefs],
  };
}
