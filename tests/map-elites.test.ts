import { describe, it, expect, beforeEach } from 'vitest';
import { MapElites } from '../src/evolution/map-elites.js';
import { createGenome, resetGenomeCounter } from '../src/evolution/genome.js';
import type { AgentConfig, StrategyBehavior } from '../src/core/types.js';

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

function makeBehavior(overrides: Partial<StrategyBehavior> = {}): StrategyBehavior {
  return {
    taskDiversity: 0.5,
    successRate: 0.5,
    toolEntropy: 0.5,
    avgTokenEfficiency: 0.5,
    learningMagnitude: 0,
    ...overrides,
  };
}

describe('MapElites', () => {
  let me: MapElites;

  beforeEach(() => {
    resetGenomeCounter();
    me = new MapElites();
  });

  it('starts empty', () => {
    expect(me.filledCells).toBe(0);
    expect(me.coverageRatio).toBe(0);
    expect(me.totalCells).toBe(64);
  });

  it('inserts into empty cells', () => {
    const g = createGenome(config);
    const accepted = me.insert(g, 10, makeBehavior({ taskDiversity: 0.5, successRate: 0.7 }));
    expect(accepted).toBe(true);
    expect(me.filledCells).toBe(1);
  });

  it('replaces lower fitness in same cell', () => {
    const g1 = createGenome(config);
    const g2 = createGenome(config);

    me.insert(g1, 5, makeBehavior());
    const replaced = me.insert(g2, 10, makeBehavior());
    expect(replaced).toBe(true);
    expect(me.filledCells).toBe(1);
  });

  it('rejects lower fitness in occupied cell', () => {
    const g1 = createGenome(config);
    const g2 = createGenome(config);

    me.insert(g1, 10, makeBehavior());
    const rejected = me.insert(g2, 5, makeBehavior());
    expect(rejected).toBe(false);
  });

  it('getRandomChampion returns null when empty', () => {
    expect(me.getRandomChampion()).toBeNull();
  });

  it('getRandomChampion returns a genome', () => {
    const g = createGenome(config);
    me.insert(g, 10, makeBehavior({ taskDiversity: 0.3, successRate: 0.3 }));

    const champion = me.getRandomChampion();
    expect(champion).not.toBeNull();
    expect(champion).not.toBe(g);
  });

  it('fills multiple cells with diverse genomes', () => {
    for (let i = 0; i < 20; i++) {
      const g = createGenome(config);
      me.insert(g, 5 + i, makeBehavior({ taskDiversity: i / 20, successRate: (20 - i) / 20 }));
    }
    expect(me.filledCells).toBeGreaterThan(1);
    expect(me.coverageRatio).toBeGreaterThan(0);
  });

  it('getCoverageMap returns correct size', () => {
    const map = me.getCoverageMap();
    expect(map.length).toBe(64);
    expect(map.every(v => v === 0)).toBe(true);

    me.insert(createGenome(config), 10, makeBehavior());
    const map2 = me.getCoverageMap();
    const nonZero = Array.from(map2).filter(v => v > 0);
    expect(nonZero.length).toBe(1);
  });
});

describe('CycleQD', () => {
  let me: MapElites;

  beforeEach(() => {
    resetGenomeCounter();
    me = new MapElites();
  });

  it('currentAxes returns correct pair per cycle', () => {
    expect(me.currentAxes).toEqual(['taskDiversity', 'successRate']);
    me.advanceCycle();
    expect(me.currentAxes).toEqual(['successRate', 'toolEntropy']);
    me.advanceCycle();
    expect(me.currentAxes).toEqual(['toolEntropy', 'avgTokenEfficiency']);
    me.advanceCycle();
    expect(me.currentAxes).toEqual(['avgTokenEfficiency', 'taskDiversity']);
  });

  it('advanceCycle rotates dimensions and re-inserts survivors', () => {
    const g = createGenome(config);
    me.insert(g, 10, makeBehavior());
    expect(me.filledCells).toBe(1);

    me.advanceCycle();
    // Survivors re-inserted under new axes — should still have coverage
    expect(me.filledCells).toBeGreaterThanOrEqual(1);
  });

  it('insert uses dimensions from current cycle', () => {
    // Cycle 0: taskDiversity × successRate
    const g1 = createGenome(config);
    const b1 = makeBehavior({ taskDiversity: 0.9, successRate: 0.1 });
    me.insert(g1, 10, b1);
    expect(me.filledCells).toBe(1);

    me.advanceCycle();
    // g1 survivor re-inserted under new axes (successRate × toolEntropy)
    const afterAdvance = me.filledCells;

    // Cycle 1: successRate × toolEntropy — new entry
    const g2 = createGenome(config);
    const b2 = makeBehavior({ successRate: 0.9, toolEntropy: 0.1 });
    me.insert(g2, 10, b2);
    expect(me.filledCells).toBeGreaterThanOrEqual(afterAdvance);
  });

  it('after 4 cycles dimensions wrap around', () => {
    const initial = me.currentAxes;
    me.advanceCycle();
    me.advanceCycle();
    me.advanceCycle();
    me.advanceCycle();
    expect(me.currentAxes).toEqual(initial);
  });
});
