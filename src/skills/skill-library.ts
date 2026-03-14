// ================================================================
//  Skill Library — Skill storage, retrieval, and fitness tracking
//
//  Skills accumulate from successful tasks. Each skill has a fitness
//  score that tracks its usefulness over time.
// ================================================================

import type { Skill, StorageAdapter } from '../core/types.js';
import { MAX_SKILLS } from '../core/types.js';

let skillCounter = 0;

export function resetSkillCounter(): void {
  skillCounter = 0;
}

export class SkillLibrary {
  private store: StorageAdapter;

  constructor(store: StorageAdapter) {
    this.store = store;
  }

  /** Add a new skill to the library (deduplicates near-identical skills) */
  async addSkill(
    type: 'code' | 'principle',
    taskTypes: string[],
    content: string,
    initialFitness = 0.5,
  ): Promise<Skill> {
    // Deduplicate: check if a similar skill already exists
    const existing = await this.store.getSkills();
    const duplicate = this.findSimilarSkill(existing, content);
    if (duplicate) {
      // Merge: keep higher fitness, union task types, increment uses
      const mergedTypes = [...new Set([...duplicate.taskTypes, ...taskTypes])];
      const mergedFitness = Math.max(duplicate.fitness, initialFitness);
      duplicate.taskTypes = mergedTypes;
      duplicate.fitness = mergedFitness;
      duplicate.uses++;
      await this.store.saveSkill(duplicate);
      return duplicate;
    }

    const skill: Skill = {
      id: `skill_${++skillCounter}`,
      type,
      taskTypes,
      content,
      fitness: initialFitness,
      uses: 0,
      successes: 0,
    };

    // Check capacity — prune lowest if at max
    if (existing.length >= MAX_SKILLS) {
      const sorted = existing.sort((a, b) => a.fitness - b.fitness);
      const toRemove = sorted[0];
      if (toRemove.fitness < initialFitness) {
        await this.store.pruneSkills(toRemove.fitness + 0.001);
      }
    }

    await this.store.saveSkill(skill);
    return skill;
  }

  /** Find an existing skill with similar content (Jaccard word similarity > 0.7) */
  private findSimilarSkill(skills: Skill[], content: string): Skill | null {
    const newWords = toWordSet(content);
    // Need enough words for meaningful comparison — short content uses exact match
    if (newWords.size < 3) {
      const norm = content.toLowerCase().trim();
      return skills.find(s => s.content.toLowerCase().trim() === norm) ?? null;
    }

    for (const skill of skills) {
      const existingWords = toWordSet(skill.content);
      if (existingWords.size < 3) continue;

      const intersection = [...newWords].filter(w => existingWords.has(w)).length;
      const union = new Set([...newWords, ...existingWords]).size;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard > 0.7) return skill;
    }
    return null;
  }

  /** Retrieve applicable skills, sorted by fitness (descending) */
  async getSkillsForTask(taskType: string, limit = 5): Promise<Skill[]> {
    const skills = await this.store.getSkills(taskType);
    return skills
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, limit);
  }

  /** Update skill fitness based on usage results (EMA) */
  async updateSkillFitness(skillId: string, score: number): Promise<void> {
    // Delta: positive for good scores, negative for bad
    const delta = (score - 0.5) * 0.2; // EMA-like adjustment
    await this.store.updateSkillFitness(skillId, delta);
  }

  /** Apply periodic fitness decay (unused skills lose relevance) */
  async decaySkills(rate = 0.995): Promise<void> {
    const skills = await this.store.getSkills();
    for (const skill of skills) {
      const decayDelta = skill.fitness * (rate - 1);
      await this.store.updateSkillFitness(skill.id, decayDelta);
    }
  }

  /** Remove skills below fitness threshold */
  async pruneSkills(threshold = 0.1): Promise<number> {
    return this.store.pruneSkills(threshold);
  }

  /** Retrieve skills by their IDs (for genome skillRefs) */
  async getSkillsByIds(ids: string[]): Promise<Skill[]> {
    if (ids.length === 0) return [];
    const all = await this.store.getSkills();
    const idSet = new Set(ids);
    return all.filter(s => idSet.has(s.id));
  }

  /** Get all skills */
  async getAllSkills(): Promise<Skill[]> {
    return this.store.getSkills();
  }
}

/** Normalize content to a set of lowercase words for similarity comparison */
function toWordSet(content: string): Set<string> {
  return new Set(
    content.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2),
  );
}
