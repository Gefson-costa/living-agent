// ================================================================
//  Exemplar Store — Few-Shot Learning via Best Examples
//
//  Stores top-performing (prompt, response, score) tuples per task
//  type. Strategies retrieve exemplars to inject as few-shot context,
//  giving the LLM concrete examples of successful patterns.
//
//  This is the living-agent equivalent of DSPy's bootstrapped
//  few-shot demonstrations.
// ================================================================

export interface Exemplar {
  taskPrompt: string;
  response: string;
  score: number;
  tokenEstimate: number;   // rough token count for budget control
}

/** Rough token estimate: ~4 chars per token */
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export class ExemplarStore {
  /** taskType → sorted exemplars (best first) */
  private store = new Map<string, Exemplar[]>();
  private maxPerType: number;

  constructor(maxPerType = 10) {
    this.maxPerType = maxPerType;
  }

  /** Record a successful exemplar for a task type */
  record(taskType: string, taskPrompt: string, response: string, score: number): void {
    if (score < 0.5) return; // only store successful examples

    const exemplar: Exemplar = {
      taskPrompt,
      response,
      score,
      tokenEstimate: estimateTokens(taskPrompt) + estimateTokens(response),
    };

    const list = this.store.get(taskType) ?? [];
    list.push(exemplar);
    // Sort by score descending
    list.sort((a, b) => b.score - a.score);
    // Keep only top-K
    if (list.length > this.maxPerType) {
      list.length = this.maxPerType;
    }
    this.store.set(taskType, list);
  }

  /** Retrieve top exemplars for a task type, respecting a token budget */
  retrieve(taskType: string, count: number, tokenBudget: number): Exemplar[] {
    const list = this.store.get(taskType);
    if (!list || list.length === 0 || count <= 0) return [];

    const result: Exemplar[] = [];
    let tokensUsed = 0;

    for (const exemplar of list) {
      if (result.length >= count) break;
      if (tokensUsed + exemplar.tokenEstimate > tokenBudget) continue;
      result.push(exemplar);
      tokensUsed += exemplar.tokenEstimate;
    }

    return result;
  }

  /** Check if we have exemplars for a given task type */
  has(taskType: string): boolean {
    return (this.store.get(taskType)?.length ?? 0) > 0;
  }

  /** Get count of exemplars for a task type */
  count(taskType: string): number {
    return this.store.get(taskType)?.length ?? 0;
  }

  /** Get total exemplar count across all types */
  get size(): number {
    let total = 0;
    for (const list of this.store.values()) {
      total += list.length;
    }
    return total;
  }

  /** Get all known task types */
  get taskTypes(): string[] {
    return [...this.store.keys()];
  }

  /** Export for persistence */
  serialize(): string {
    const obj: Record<string, Exemplar[]> = {};
    for (const [type, list] of this.store) {
      obj[type] = list;
    }
    return JSON.stringify(obj);
  }

  /** Import from persistence */
  static deserialize(json: string): ExemplarStore {
    const store = new ExemplarStore();
    try {
      const obj = JSON.parse(json) as Record<string, Exemplar[]>;
      for (const [type, list] of Object.entries(obj)) {
        store.store.set(type, list);
      }
    } catch {
      // Corrupted data — start fresh
    }
    return store;
  }
}
