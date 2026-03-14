// ================================================================
//  MAP-Elites — Behavioral Niche Archive
//
//  Grid axes: task_diversity x success_rate
//  1. RESCUE: Inject archived champions during population crashes
//  2. DIVERSITY: Alternative configurations survive in the archive
// ================================================================

import type { StrategyGenome, StrategyBehavior } from '../core/types.js';
import { MAP_ELITES_SIZE } from '../core/types.js';
import { cloneGenome } from './genome.js';

interface EliteCell {
  genome: StrategyGenome;
  fitness: number;
}

export class MapElites {
  private grid: (EliteCell | null)[] = new Array(MAP_ELITES_SIZE * MAP_ELITES_SIZE).fill(null);
  private coverage = 0;
  private cycleIndex = 0;

  private static readonly DIMENSIONS: readonly (keyof StrategyBehavior)[] =
    ['taskDiversity', 'successRate', 'toolEntropy', 'avgTokenEfficiency'];

  get currentAxes(): [string, string] {
    const d = MapElites.DIMENSIONS;
    return [d[this.cycleIndex % d.length], d[(this.cycleIndex + 1) % d.length]];
  }

  advanceCycle(): void {
    this.cycleIndex++;
    this.grid.fill(null);
    this.coverage = 0;
  }

  /** Map behavior metrics to niche coordinates */
  private toCell(bx: number, by: number): [number, number] {
    const cx = Math.min(
      MAP_ELITES_SIZE - 1,
      Math.max(0, (bx * MAP_ELITES_SIZE) | 0),
    );
    const cy = Math.min(
      MAP_ELITES_SIZE - 1,
      Math.max(0, (by * MAP_ELITES_SIZE) | 0),
    );
    return [cx, cy];
  }

  /** Try to insert a genome into the archive. Returns true if accepted. */
  insert(
    genome: StrategyGenome,
    fitness: number,
    behavior: StrategyBehavior,
  ): boolean {
    const [axName, ayName] = this.currentAxes;
    const bx = behavior[axName as keyof StrategyBehavior];
    const by = behavior[ayName as keyof StrategyBehavior];
    const [cx, cy] = this.toCell(bx, by);
    const idx = cy * MAP_ELITES_SIZE + cx;
    const existing = this.grid[idx];

    if (!existing || fitness > existing.fitness) {
      this.grid[idx] = {
        genome: cloneGenome(genome),
        fitness,
      };
      if (!existing) this.coverage++;
      return true;
    }
    return false;
  }

  /** Get a random champion via tournament selection (size 3) */
  getRandomChampion(): StrategyGenome | null {
    const occupied: number[] = [];
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i]) occupied.push(i);
    }
    if (occupied.length === 0) return null;

    let bestIdx = occupied[(Math.random() * occupied.length) | 0];
    let bestFit = this.grid[bestIdx]!.fitness;
    for (let t = 0; t < 2; t++) {
      const idx = occupied[(Math.random() * occupied.length) | 0];
      const cell = this.grid[idx]!;
      if (cell.fitness > bestFit) {
        bestFit = cell.fitness;
        bestIdx = idx;
      }
    }

    return cloneGenome(this.grid[bestIdx]!.genome);
  }

  get coverageRatio(): number {
    return this.coverage / (MAP_ELITES_SIZE * MAP_ELITES_SIZE);
  }

  get filledCells(): number {
    return this.coverage;
  }

  get totalCells(): number {
    return MAP_ELITES_SIZE * MAP_ELITES_SIZE;
  }

  /** Get the full grid for persistence */
  getGrid(): ({ genome: StrategyGenome; fitness: number } | null)[] {
    return this.grid.map(cell =>
      cell ? { genome: cloneGenome(cell.genome), fitness: cell.fitness } : null,
    );
  }

  getCoverageMap(): Float32Array {
    const map = new Float32Array(MAP_ELITES_SIZE * MAP_ELITES_SIZE);
    for (let i = 0; i < this.grid.length; i++) {
      map[i] = this.grid[i] ? this.grid[i]!.fitness : 0;
    }
    return map;
  }
}
