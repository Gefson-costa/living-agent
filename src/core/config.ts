// ================================================================
//  Config — Default AgentConfig builder
// ================================================================

import type { AgentConfig } from './types.js';

export function createDefaultConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    strategyCount: 16,
    mutationRate: 1.0,
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
