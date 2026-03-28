// ================================================================
//  Skill Library — Skill storage, retrieval, and fitness tracking
//
//  Skills accumulate from successful tasks. Each skill has a fitness
//  score that tracks its usefulness over time. When an Embedder is
//  provided, skills are indexed as vectors for semantic retrieval
//  (Vector Memory — ARCHITECTURE_DECISION.md #7).
// ================================================================

import type { Skill, StorageAdapter } from '../core/types.js';
import { MAX_SKILLS } from '../core/types.js';
import type { Embedder } from '../embeddings/embedder.js';
import { cosineSimilarity } from '../embeddings/embedder.js';

let skillCounter = 0;

export function resetSkillCounter(): void {
  skillCounter = 0;
}

export class SkillLibrary {
  private store: StorageAdapter;
  private embedder: Embedder | null = null;
  private embeddings = new Map<string, Float32Array>();

  constructor(store: StorageAdapter, embedder?: Embedder) {
    this.store = store;
    if (embedder) this.embedder = embedder;
  }

  /** Set or replace the embedder (called after async init) */
  setEmbedder(embedder: Embedder): void {
    this.embedder = embedder;
  }

  /** Embed all existing skills (call once after init when embedder becomes available) */
  async initEmbeddings(): Promise<void> {
    if (!this.embedder) return;
    const skills = await this.store.getSkills();
    if (skills.length === 0) return;
    const texts = skills.map(s => s.content);
    const vectors = await this.embedder.embedBatch(texts);
    for (let i = 0; i < skills.length; i++) {
      this.embeddings.set(skills[i].id, vectors[i]);
    }
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

    // Embed new content if embedder available (reuse for dedup + cache)
    let contentEmbedding: Float32Array | null = null;
    if (this.embedder) {
      contentEmbedding = await this.embedder.embed(content);
    }

    const duplicate = this.findSimilarSkill(existing, content, contentEmbedding);
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
        this.embeddings.delete(toRemove.id);
      }
    }

    await this.store.saveSkill(skill);

    // Cache embedding for the new skill
    if (contentEmbedding) {
      this.embeddings.set(skill.id, contentEmbedding);
    }

    return skill;
  }

  /** Find an existing skill with similar content.
   *  Uses embedding cosine similarity (>0.85) when available, falls back to Jaccard (>0.7). */
  private findSimilarSkill(
    skills: Skill[],
    content: string,
    contentEmbedding: Float32Array | null,
  ): Skill | null {
    // Embedding-based dedup (preferred)
    if (contentEmbedding && this.embeddings.size > 0) {
      let bestSkill: Skill | null = null;
      let bestSim = 0;
      for (const skill of skills) {
        const emb = this.embeddings.get(skill.id);
        if (!emb) continue;
        const sim = cosineSimilarity(contentEmbedding, emb);
        if (sim > bestSim) {
          bestSim = sim;
          bestSkill = skill;
        }
      }
      if (bestSkill && bestSim > 0.85) return bestSkill;
    }

    // Fallback: Jaccard word similarity
    const newWords = toWordSet(content);
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

  /** Retrieve skills by semantic similarity to a task embedding.
   *  Scores combine: 50% relevance + 30% fitness + 20% recency. */
  async getSkillsBySimilarity(
    taskEmbedding: Float32Array,
    limit = 5,
    threshold = 0.3,
  ): Promise<Skill[]> {
    const skills = await this.store.getSkills();
    if (skills.length === 0 || this.embeddings.size === 0) return [];

    const now = Date.now();
    const scored: { skill: Skill; score: number }[] = [];
    for (const skill of skills) {
      const emb = this.embeddings.get(skill.id);
      if (!emb) continue;
      const sim = cosineSimilarity(taskEmbedding, emb);
      if (sim < threshold) continue;
      // Recency: exponential decay — skills updated within last hour get ~1.0
      const updatedMs = skill.updatedAt ? new Date(skill.updatedAt).getTime() : 0;
      const ageHours = Math.max(0, (now - updatedMs) / 3_600_000);
      const recency = Math.exp(-ageHours / 24); // half-life ~24h
      const score = sim * 0.5 + skill.fitness * 0.3 + recency * 0.2;
      scored.push({ skill, score });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.skill);
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
    // Clean up embedding cache for pruned skills
    const before = await this.store.getSkills();
    const toPrune = before.filter(s => s.fitness < threshold);
    for (const s of toPrune) this.embeddings.delete(s.id);

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

  /** Check if vector retrieval is available */
  hasEmbedder(): boolean {
    return this.embedder !== null;
  }

  /** Get the cached embedding for a skill (or null) */
  getEmbedding(skillId: string): Float32Array | null {
    return this.embeddings.get(skillId) ?? null;
  }
}

/** Normalize content to a set of lowercase words for similarity comparison */
function toWordSet(content: string): Set<string> {
  return new Set(
    content.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2),
  );
}
