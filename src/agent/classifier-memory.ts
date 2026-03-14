// ================================================================
//  Classifier Memory — Adaptive keyword-tasktype boost weights
//
//  Tracks per-keyword-per-tasktype reinforcement signals, allowing
//  the classifier to learn from experience which keywords predict
//  which task types best.
// ================================================================

import type { TaskType } from './interaction.js';

interface BoostEntry {
  weight: number;
  count: number;
}

export class ClassifierMemory {
  // Map<keyword, Map<taskType, BoostEntry>>
  private boosts = new Map<string, Map<TaskType, BoostEntry>>();
  private readonly learningRate: number;
  private readonly decayRate: number;

  constructor(learningRate = 0.1, decayRate = 0.995) {
    this.learningRate = learningRate;
    this.decayRate = decayRate;
  }

  /** Reinforce or penalize keyword-tasktype associations based on outcome */
  adjustWeights(message: string, taskType: TaskType, score: number): void {
    const keywords = this.extractKeywords(message);
    const delta = (score - 0.5) * this.learningRate;

    for (const keyword of keywords) {
      if (!this.boosts.has(keyword)) {
        this.boosts.set(keyword, new Map());
      }
      const typeMap = this.boosts.get(keyword)!;

      // Reinforce the correct type
      const entry = typeMap.get(taskType) ?? { weight: 0, count: 0 };
      entry.weight += delta;
      entry.count++;
      typeMap.set(taskType, entry);
    }
  }

  /** Get the adaptive boost for a keyword-tasktype pair */
  getBoost(keyword: string, taskType: TaskType): number {
    const typeMap = this.boosts.get(keyword.toLowerCase());
    if (!typeMap) return 0;
    const entry = typeMap.get(taskType);
    if (!entry) return 0;
    return entry.weight;
  }

  /** Get total boost for a message-tasktype pair (sum of keyword boosts) */
  getMessageBoost(message: string, taskType: TaskType): number {
    const keywords = this.extractKeywords(message);
    let total = 0;
    for (const keyword of keywords) {
      total += this.getBoost(keyword, taskType);
    }
    return total;
  }

  /** Apply periodic decay to prevent stale weights from dominating */
  decay(): void {
    for (const [, typeMap] of this.boosts) {
      for (const [, entry] of typeMap) {
        entry.weight *= this.decayRate;
      }
    }
  }

  /** Serialize for persistence */
  serialize(): string {
    const data: Record<string, Record<string, BoostEntry>> = {};
    for (const [keyword, typeMap] of this.boosts) {
      data[keyword] = {};
      for (const [type, entry] of typeMap) {
        data[keyword][type] = entry;
      }
    }
    return JSON.stringify(data);
  }

  /** Restore from serialized data */
  static deserialize(json: string): ClassifierMemory {
    const memory = new ClassifierMemory();
    try {
      const data = JSON.parse(json) as Record<string, Record<string, BoostEntry>>;
      for (const [keyword, types] of Object.entries(data)) {
        const typeMap = new Map<TaskType, BoostEntry>();
        for (const [type, entry] of Object.entries(types)) {
          typeMap.set(type as TaskType, entry);
        }
        memory.boosts.set(keyword, typeMap);
      }
    } catch {
      // Corrupted data — return empty memory
    }
    return memory;
  }

  private extractKeywords(message: string): string[] {
    return message.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 20); // cap to prevent explosion
  }
}
