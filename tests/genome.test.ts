import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGenome,
  mutateGenome,
  crossoverGenomes,
  geneticDistance,
  cloneGenome,
  resetGenomeCounter,
} from '../src/evolution/genome.js';
import type { AgentConfig } from '../src/core/types.js';

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const config: AgentConfig = {
  strategyCount: 16,
 
  mutationRate: 1.0,
  promptStyleDim: 8,
  toolCount: 4,
  noveltyWeight: 0.5,
  elitismRate: 0.1,
  cullThreshold: -2,
  taskBatchSize: 10,
  rescueThreshold: 0.15,
  toolNames: ['a', 'b', 'c', 'd'],
  systemPromptTemplate: 'test',
};

describe('genome', () => {
  beforeEach(() => resetGenomeCounter());

  it('createGenome produces valid genome', () => {
    const rng = mulberry32(1);
    const g = createGenome(config, rng);

    expect(g.temperature).toBeGreaterThanOrEqual(0);
    expect(g.temperature).toBeLessThanOrEqual(1);
    expect(g.maxTokenBudget).toBeGreaterThanOrEqual(100);
    expect(g.maxTokenBudget).toBeLessThanOrEqual(4096);
    expect(g.promptStyle.length).toBe(8);
    expect(g.toolPreferences.length).toBe(4);
    expect(g.mutability).toBeGreaterThanOrEqual(0.5);
    expect(g.mutability).toBeLessThanOrEqual(2.0);
    expect(g.habitatPref).toBeGreaterThanOrEqual(0);
    expect(g.habitatPref).toBeLessThanOrEqual(1);
    expect(g.reasoningDepth).toBeGreaterThanOrEqual(0);
    expect(g.reasoningDepth).toBeLessThanOrEqual(1);
    expect(g.id).toBe('strat_1');
    expect(g.skillRefs).toEqual([]);
  });

  it('mutateGenome produces different genome', () => {
    const rng = mulberry32(2);
    const parent = createGenome(config, rng);
    const child = mutateGenome(parent, 1.0, config, rng);

    expect(child.id).not.toBe(parent.id);
    let differences = 0;
    for (let i = 0; i < parent.promptStyle.length; i++) {
      if (parent.promptStyle[i] !== child.promptStyle[i]) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('mutateGenome respects bounds', () => {
    const rng = mulberry32(3);
    const parent = createGenome(config, rng);

    let g = parent;
    for (let i = 0; i < 100; i++) {
      g = mutateGenome(g, 2.0, config, rng);
    }

    expect(g.temperature).toBeGreaterThanOrEqual(0);
    expect(g.temperature).toBeLessThanOrEqual(1);
    expect(g.maxTokenBudget).toBeGreaterThanOrEqual(100);
    expect(g.maxTokenBudget).toBeLessThanOrEqual(4096);
    expect(g.mutability).toBeGreaterThanOrEqual(0.5);
    expect(g.mutability).toBeLessThanOrEqual(2.0);
    expect(g.learningRate).toBeGreaterThanOrEqual(0.001);
    expect(g.learningRate).toBeLessThanOrEqual(0.04);
    expect(g.habitatPref).toBeGreaterThanOrEqual(0);
    expect(g.habitatPref).toBeLessThanOrEqual(1);
    expect(g.reasoningDepth).toBeGreaterThanOrEqual(0);
    expect(g.reasoningDepth).toBeLessThanOrEqual(1);
    expect(g.lamarckianRate).toBeGreaterThanOrEqual(0);
    expect(g.lamarckianRate).toBeLessThanOrEqual(0.25);
    for (let i = 0; i < g.promptStyle.length; i++) {
      expect(g.promptStyle[i]).toBeGreaterThanOrEqual(-1);
      expect(g.promptStyle[i]).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < g.toolPreferences.length; i++) {
      expect(g.toolPreferences[i]).toBeGreaterThanOrEqual(0);
      expect(g.toolPreferences[i]).toBeLessThanOrEqual(1);
    }
  });

  it('crossoverGenomes blends parents', () => {
    const rng = mulberry32(4);
    const a = createGenome(config, rng);
    const b = createGenome(config, rng);
    const child = crossoverGenomes(a, b, config, rng);

    // Temperature should be a blend (60/40)
    const expected = a.temperature * 0.6 + b.temperature * 0.4;
    expect(child.temperature).toBeCloseTo(expected, 5);

    // PromptStyle: each element from one parent or the other
    for (let i = 0; i < child.promptStyle.length; i++) {
      const matchA = child.promptStyle[i] === a.promptStyle[i];
      const matchB = child.promptStyle[i] === b.promptStyle[i];
      expect(matchA || matchB).toBe(true);
    }
  });

  it('crossoverGenomes clamps temperature to [0, 1]', () => {
    const rng = mulberry32(42);
    const a = createGenome(config, rng);
    const b = createGenome(config, rng);
    // Force high temperatures near the boundary
    a.temperature = 0.95;
    b.temperature = 0.98;
    const child = crossoverGenomes(a, b, config, rng);
    expect(child.temperature).toBeGreaterThanOrEqual(0);
    expect(child.temperature).toBeLessThanOrEqual(1);
  });

  it('crossoverGenomes merges skillRefs', () => {
    const rng = mulberry32(5);
    const a = createGenome(config, rng);
    const b = createGenome(config, rng);
    a.skillRefs = ['skill_1', 'skill_2'];
    b.skillRefs = ['skill_2', 'skill_3'];
    const child = crossoverGenomes(a, b, config, rng);

    expect(child.skillRefs).toContain('skill_1');
    expect(child.skillRefs).toContain('skill_2');
    expect(child.skillRefs).toContain('skill_3');
    expect(child.skillRefs.length).toBe(3);
  });

  it('geneticDistance is 0 for identical genomes', () => {
    const rng = mulberry32(6);
    const g = createGenome(config, rng);
    expect(geneticDistance(g, g)).toBeCloseTo(0, 5);
  });

  it('geneticDistance is symmetric', () => {
    const rng = mulberry32(7);
    const a = createGenome(config, rng);
    const b = createGenome(config, rng);
    expect(geneticDistance(a, b)).toBeCloseTo(geneticDistance(b, a), 5);
  });

  it('cloneGenome produces independent copy', () => {
    const rng = mulberry32(8);
    const original = createGenome(config, rng);
    original.skillRefs = ['skill_1'];
    const clone = cloneGenome(original);

    expect(clone.id).toBe(original.id);
    expect(clone.temperature).toBe(original.temperature);
    expect(clone.reasoningDepth).toBe(original.reasoningDepth);
    expect(clone.promptStyle).not.toBe(original.promptStyle);
    expect(clone.promptStyle[0]).toBe(original.promptStyle[0]);
    expect(clone.skillRefs).toEqual(['skill_1']);
    expect(clone.skillRefs).not.toBe(original.skillRefs);

    clone.promptStyle[0] = 999;
    expect(original.promptStyle[0]).not.toBe(999);

    clone.skillRefs.push('skill_2');
    expect(original.skillRefs.length).toBe(1);
  });
});
