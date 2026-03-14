// ================================================================
//  Memory Store — In-memory StorageAdapter implementation
//
//  For development, testing, and Phase 1 compatibility.
//  No external dependencies.
// ================================================================

import type {
  StorageAdapter, Strategy, Experience, ExperienceFilter,
  Skill, MapElitesCell,
} from '../core/types.js';

export class MemoryStore implements StorageAdapter {
  private strategies = new Map<string, Strategy>();
  private experiences: Experience[] = [];
  private skills = new Map<string, Skill>();
  private grid: MapElitesCell[] | null = null;
  private metadata = new Map<string, string>();

  async saveStrategy(strategy: Strategy): Promise<void> {
    this.strategies.set(strategy.genome.id, strategy);
  }

  async loadStrategies(): Promise<Strategy[]> {
    return [...this.strategies.values()];
  }

  async recordExperience(exp: Experience): Promise<void> {
    this.experiences.push({ ...exp, id: this.experiences.length + 1 });
  }

  async queryExperiences(filter: ExperienceFilter): Promise<Experience[]> {
    let results = [...this.experiences];

    if (filter.strategyId) {
      results = results.filter(e => e.strategyId === filter.strategyId);
    }
    if (filter.taskType) {
      results = results.filter(e => e.taskType === filter.taskType);
    }
    if (filter.minScore !== undefined) {
      results = results.filter(e => e.score >= filter.minScore!);
    }
    if (filter.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  async saveSkill(skill: Skill): Promise<void> {
    this.skills.set(skill.id, { ...skill });
  }

  async getSkills(taskType?: string): Promise<Skill[]> {
    const all = [...this.skills.values()];
    if (!taskType) return all;
    return all.filter(s => s.taskTypes.includes(taskType));
  }

  async updateSkillFitness(skillId: string, delta: number): Promise<void> {
    const skill = this.skills.get(skillId);
    if (skill) {
      skill.fitness += delta;
      skill.uses++;
      if (delta > 0) skill.successes++;
    }
  }

  async pruneSkills(minFitness: number): Promise<number> {
    let pruned = 0;
    for (const [id, skill] of this.skills) {
      if (skill.fitness < minFitness) {
        this.skills.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  async saveGrid(grid: MapElitesCell[]): Promise<void> {
    this.grid = grid.map(c => ({ ...c }));
  }

  async loadGrid(): Promise<MapElitesCell[] | null> {
    return this.grid;
  }

  async saveMetadata(key: string, value: string): Promise<void> {
    this.metadata.set(key, value);
  }

  async loadMetadata(key: string): Promise<string | null> {
    return this.metadata.get(key) ?? null;
  }
}
