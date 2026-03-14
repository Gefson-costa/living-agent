// ================================================================
//  Living Agent — Interaction Types
//
//  Types for the interactive agent mode: task classification,
//  interaction tracking, agent configuration, and status.
// ================================================================

// ── Task Types ─────────────────────────────────────────────────

export type TaskType =
  | 'research'
  | 'coding'
  | 'analysis'
  | 'creative'
  | 'summarization'
  | 'general';

export const TASK_TYPES: TaskType[] = [
  'research', 'coding', 'analysis', 'creative', 'summarization', 'general',
];

// ── Interaction ────────────────────────────────────────────────

import type { EngagementMetrics } from '../core/types.js';

export interface Interaction {
  id: string;
  userMessage: string;
  taskType: TaskType;
  strategyId: string;
  response: string;
  selfEvalScore: number;
  userFeedback: number | null;      // null until user provides feedback
  engagementScore: number | null;   // null until next message or reportNoReply
  engagementMetrics: EngagementMetrics | null;
  hybridFitness: number;
  tokensUsed: number;
  latencyMs: number;
  timestamp: number;
  skillsUsed: string[];             // IDs of skills injected into prompt
}

// ── Living Agent Config ────────────────────────────────────────

export interface LivingAgentConfig {
  strategyCount: number;             // population size (default 8)
  promptStyleDim: number;            // dimension of promptStyle vector (default 4)
  toolCount: number;                 // number of tools (default 4)
  toolNames: string[];               // tool name labels
  systemPromptTemplate: string;      // base system prompt
  mutationRate: number;              // genome mutation rate (default 1.0)

  epsilon: number;                   // exploration rate (default 0.15)
  consolidateEvery: number;          // interactions between consolidations (default 20)
  skillExtractionThreshold: number;  // min score for skill extraction (default 0.8)

  distillMinExperiences: number;     // min experiences per task type before distillation (default 10)
  distillWithLLM: boolean;           // use LLM for principle distillation (default true)

  maxHistoryTurns: number;           // max conversation turns to keep (default 20)
  noReplyTimeoutMs: number;          // timeout for no-reply auto-finalization (default 300000 = 5min)

  sqlitePath?: string;               // path for persistent storage
}

export const DEFAULT_LIVING_AGENT_CONFIG: LivingAgentConfig = {
  strategyCount: 8,
  promptStyleDim: 4,
  toolCount: 4,
  toolNames: ['search', 'code', 'analyze', 'summarize'],
  systemPromptTemplate: 'You are a helpful AI assistant. Solve the given task.',
  mutationRate: 1.0,

  epsilon: 0.15,
  consolidateEvery: 10,
  skillExtractionThreshold: 0.8,

  distillMinExperiences: 10,
  distillWithLLM: true,

  maxHistoryTurns: 20,
  noReplyTimeoutMs: 300_000,
};

// ── Agent Status ───────────────────────────────────────────────

import type { FitnessWeights } from '../core/types.js';

export interface AgentStatus {
  totalInteractions: number;
  consolidations: number;
  strategyCount: number;
  avgFitness: number;
  bestFitness: number;
  bestStrategyId: string;
  mapElitesCoverage: number;
  noveltyArchiveSize: number;
  skillCount: number;
  principleCount: number;
  taskTypeDistribution: Record<string, number>;
  populationHealth: 'healthy' | 'struggling' | 'critical';
  fitnessWeights: FitnessWeights | null;
}
