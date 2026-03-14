// ================================================================
//  Reward Learning — Within-Lifetime Strategy Adaptation
//
//  Birth snapshots, reward-modulated updates, decay toward birth
//  weights, and Lamarckian transfer to offspring.
//
//  Adapted from SwarmCore's learning.ts — removes age bonus,
//  dream consolidation, and teaching (handled by consolidation.ts).
// ================================================================

import type { Strategy, StrategyGenome } from '../core/types.js';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Birth Snapshot ─────────────────────────────────────────────

/** Freeze current promptStyle and toolPreferences as birth reference */
export function snapshotBirthWeights(strategy: Strategy): void {
  strategy.birthWeights = {
    promptStyle: new Float32Array(strategy.genome.promptStyle),
    toolPreferences: new Float32Array(strategy.genome.toolPreferences),
  };
}

// ── Reward Signal ──────────────────────────────────────────────

/** Compute reward signal from fitness delta. Range 0.2..4.0
 *  Negative deltas are weighted 1.5x (Kahneman-Tversky loss aversion). */
export function computeRewardSignal(currentFitness: number, prevFitness: number): number {
  const delta = currentFitness - prevFitness;
  const asymmetricDelta = delta < 0 ? delta * 1.5 : delta;
  return 1 + clamp(asymmetricDelta * 8, -0.8, 3.0);
}

// ── Reward-Modulated Update ────────────────────────────────────

/** Update promptStyle and toolPreferences based on task performance */
export function rewardModulatedUpdate(strategy: Strategy, prevFitness: number): void {
  if (!strategy.birthWeights) return;
  if (strategy.genome.learningRate <= 0) return;
  if (strategy.taskHistory.length === 0) return;

  const rewardSignal = computeRewardSignal(strategy.fitness, prevFitness);
  const effectiveRate = strategy.genome.learningRate * rewardSignal;

  const recent = strategy.taskHistory[strategy.taskHistory.length - 1];
  const score = recent.score;

  // Nudge promptStyle: high score reinforces current direction, low score dampens
  const style = strategy.genome.promptStyle;
  for (let i = 0; i < style.length; i++) {
    const direction = score > 0.5 ? style[i] : -style[i] * 0.5;
    style[i] = clamp(style[i] + direction * effectiveRate, -1, 1);
  }

  // Nudge toolPreferences: boost tools on success, dampen on failure
  const tools = strategy.genome.toolPreferences;
  for (let i = 0; i < tools.length; i++) {
    const nudge = score > 0.5 ? (1 - tools[i]) * effectiveRate : -tools[i] * effectiveRate * 0.5;
    tools[i] = clamp(tools[i] + nudge, 0, 1);
  }
}

// ── Decay Toward Birth ─────────────────────────────────────────

/** Drift promptStyle/toolPrefs back toward birth values. Prevents runaway drift. */
export function decayTowardBirth(strategy: Strategy): void {
  if (!strategy.birthWeights) return;

  const rate = strategy.genome.learningRate * 0.2;
  if (rate <= 0) return;

  const style = strategy.genome.promptStyle;
  const birthStyle = strategy.birthWeights.promptStyle;
  for (let i = 0; i < style.length; i++) {
    style[i] += (birthStyle[i] - style[i]) * rate;
  }

  const tools = strategy.genome.toolPreferences;
  const birthTools = strategy.birthWeights.toolPreferences;
  for (let i = 0; i < tools.length; i++) {
    tools[i] += (birthTools[i] - tools[i]) * rate;
  }
}

// ── Lamarckian Inheritance ─────────────────────────────────────

/** Blend parent strategy's learned weight deltas into child genome */
export function lamarckianTransfer(
  parent: Strategy,
  childGenome: StrategyGenome,
): void {
  if (!parent.birthWeights) return;
  const rate = parent.genome.lamarckianRate;
  if (rate <= 0) return;

  const pStyle = parent.genome.promptStyle;
  const pBirth = parent.birthWeights.promptStyle;
  for (let i = 0; i < pStyle.length; i++) {
    const delta = pStyle[i] - pBirth[i];
    childGenome.promptStyle[i] = clamp(childGenome.promptStyle[i] + delta * rate, -1, 1);
  }

  const pTools = parent.genome.toolPreferences;
  const pBirthTools = parent.birthWeights.toolPreferences;
  for (let i = 0; i < pTools.length; i++) {
    const delta = pTools[i] - pBirthTools[i];
    childGenome.toolPreferences[i] = clamp(childGenome.toolPreferences[i] + delta * rate, 0, 1);
  }
}

// ── Learning Magnitude ─────────────────────────────────────────

/** Compute how much a strategy has drifted from birth weights */
export function learningMagnitude(strategy: Strategy): number {
  if (!strategy.birthWeights) return 0;

  let sum = 0;
  const style = strategy.genome.promptStyle;
  const birthStyle = strategy.birthWeights.promptStyle;
  for (let i = 0; i < style.length; i++) {
    sum += Math.abs(style[i] - birthStyle[i]);
  }

  const tools = strategy.genome.toolPreferences;
  const birthTools = strategy.birthWeights.toolPreferences;
  for (let i = 0; i < tools.length; i++) {
    sum += Math.abs(tools[i] - birthTools[i]);
  }

  const total = style.length + tools.length;
  return total > 0 ? sum / total : 0;
}
