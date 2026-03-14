// ================================================================
//  Self-Coding Archive — Persist history of coding attempts
//
//  Keeps a bounded history of all self-coding attempts for
//  analysis and anti-loop detection.
// ================================================================

import type { StorageAdapter } from '../core/types.js';
import type { CodingAttempt } from './types.js';

const MAX_HISTORY = 100;
const STORAGE_KEY = 'selfCodingArchive';

export class SelfCodingArchive {
  private store: StorageAdapter;
  private history: CodingAttempt[] = [];

  constructor(store: StorageAdapter) {
    this.store = store;
  }

  /** Load history from persistent storage */
  async load(): Promise<void> {
    const data = await this.store.loadMetadata(STORAGE_KEY);
    if (data) {
      try {
        this.history = JSON.parse(data);
      } catch {
        this.history = [];
      }
    }
  }

  /** Record a coding attempt */
  async record(attempt: CodingAttempt): Promise<void> {
    this.history.push(attempt);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
    await this.save();
  }

  /** Get the full attempt history */
  getHistory(): CodingAttempt[] {
    return [...this.history];
  }

  /** Get success rate over all recorded attempts */
  getSuccessRate(): number {
    const completed = this.history.filter(a => a.result !== null);
    if (completed.length === 0) return 0;
    const successes = completed.filter(a => a.result!.success);
    return successes.length / completed.length;
  }

  /** Count consecutive failures from the end */
  getConsecutiveFailures(): number {
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (!this.history[i].result || !this.history[i].result!.success) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /** Get the total number of attempts */
  get size(): number {
    return this.history.length;
  }

  private async save(): Promise<void> {
    await this.store.saveMetadata(STORAGE_KEY, JSON.stringify(this.history));
  }
}
