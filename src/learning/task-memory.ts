// ================================================================
//  Task Memory — Per-type specialization tracking
//
//  Extracted from SwarmCore's cooperation.ts — only the task-type
//  memory functions relevant to strategy specialization.
// ================================================================

import type { Strategy } from '../core/types.js';
import { MAX_TASK_TYPES } from '../core/types.js';

/** Track per-type success rate. Exponential moving average. */
export function updateTaskTypeMemory(strategy: Strategy, taskType: string, score: number): void {
  const clamped = Math.max(0, Math.min(1, score));
  const current = strategy.taskTypeMemory.get(taskType) ?? 0.5;
  strategy.taskTypeMemory.set(taskType, current * 0.8 + clamped * 0.2);

  // Evict lowest entry when exceeding MAX_TASK_TYPES
  if (strategy.taskTypeMemory.size > MAX_TASK_TYPES) {
    let worstKey = '';
    let worstVal = Infinity;
    for (const [key, val] of strategy.taskTypeMemory) {
      if (val < worstVal) { worstVal = val; worstKey = key; }
    }
    if (worstKey) strategy.taskTypeMemory.delete(worstKey);
  }
}

/** Decay all task-type memory entries. Remove entries below 0.05. */
export function decayTaskTypeMemory(strategy: Strategy, rate = 0.97): void {
  const toDelete: string[] = [];
  for (const [key, val] of strategy.taskTypeMemory) {
    const decayed = val * rate;
    if (decayed < 0.05) {
      toDelete.push(key);
    } else {
      strategy.taskTypeMemory.set(key, decayed);
    }
  }
  for (const key of toDelete) strategy.taskTypeMemory.delete(key);
}
