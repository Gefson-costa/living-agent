// ================================================================
//  Config — Default AgentConfig builder
// ================================================================

import type { AgentConfig } from './types.js';

export function createDefaultConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    strategyCount: 16,
    mutationRate: 0.15,
    promptStyleDim: 4,
    toolCount: 4,
    noveltyWeight: 0.8,
    elitismRate: 0.1,
    cullThreshold: -2,
    taskBatchSize: 8,
    rescueThreshold: 0.15,
    toolNames: ['search', 'code', 'analyze', 'summarize'],
    systemPromptTemplate: 'You are a helpful AI assistant. Solve the given task.',
    ...overrides,
  };
}

/**
 * Config optimized for local/small models (Ollama, ≤14B params).
 *
 * Key differences from default:
 * - Smaller population (6) — fewer wasted LLM calls on dead strategies
 * - Aggressive culling (-1) — kill non-functional strategies fast
 * - Smaller batch (4) — faster feedback loop per cycle
 * - Higher elitism (0.25) — protect the few strategies that work
 * - Lower mutation rate (0.6) — small models are fragile, big mutations break them
 * - Concurrency 1-2 — local GPU processes sequentially
 */
export function createLocalConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return createDefaultConfig({
    strategyCount: 6,
    mutationRate: 0.6,
    cullThreshold: -1,
    taskBatchSize: 4,
    elitismRate: 0.25,
    rescueThreshold: 0.25,
    localMode: true,
    maxTemperature: 0.5,
    maxTokenCeiling: 2500,
    concurrency: 2,
    ...overrides,
  });
}
