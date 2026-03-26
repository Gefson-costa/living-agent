// ================================================================
//  Living Agent — Public API
//
//  One agent with an internal ecology of strategies that compete
//  and evolve based on real task performance.
// ================================================================

// Types
export type {
  StrategyGenome,
  StrategyWeights,
  Strategy,
  StrategyBehavior,
  Task,
  TaskResult,
  EcologyStats,
  AgentConfig,
  EcologyCallbacks,
  LLMResponse,
  LLMAdapter,
  LLMConfig,
  ChatMessage,
  TaskEvaluator,
  Experience,
  ExperienceFilter,
  Skill,
  FitnessWeights,
  FitnessSignal,
  EngagementMetrics,
  MapElitesCell,
  StorageAdapter,
} from './core/types.js';

export {
  MAX_STRATEGIES, MAP_ELITES_SIZE, MAX_ARCHIVE, NOVELTY_K,
  MAX_TASK_HISTORY, MAX_SKILLS, MAX_TASK_TYPES,
} from './core/types.js';

// Config
export { createDefaultConfig } from './core/config.js';

// Genome operations
export {
  createGenome,
  mutateGenome,
  crossoverGenomes,
  geneticDistance,
  cloneGenome,
  resetGenomeCounter,
} from './evolution/genome.js';

// Novelty search
export { NoveltyArchive } from './evolution/novelty.js';

// MAP-Elites behavioral archive
export { MapElites } from './evolution/map-elites.js';

// Elo rating
export { EloTracker } from './evolution/elo-tracker.js';

// Evolution engine — shared evolutionary primitives
export {
  applyFitnessDecay,
  selectParents,
  breedOffspring,
  createOffspringStrategy,
  computeNoveltySeed,
  rescueFromElites,
  applyTaskMemoryDecay,
} from './evolution/evolution-engine.js';
export type { OffspringOptions, RescueOptions } from './evolution/evolution-engine.js';

// LLM adapters
export { MockAdapter, AnthropicAdapter, OpenAICompatibleAdapter, buildSystemPrompt, genomeToLLMConfig } from './llm/adapter.js';
export type { OpenAIAdapterConfig } from './llm/adapter.js';

// Prompt builder
export { buildStrategyPrompt, strategyToLLMConfig } from './llm/prompt-builder.js';

// Task evaluators
export { MathEvaluator, CustomEvaluator } from './fitness/evaluator.js';

// Task memory
export { updateTaskTypeMemory, decayTaskTypeMemory } from './learning/task-memory.js';

// Main orchestrator
export { Ecology } from './evolution/ecology.js';

// Storage (Phase 2)
export { MemoryStore } from './storage/memory-store.js';
export { SqliteStore } from './storage/sqlite-store.js';
export { RedisStore } from './storage/redis-store.js';

// Skills (Phase 2)
export { SkillLibrary } from './skills/skill-library.js';
export { SkillExtractor } from './skills/skill-extractor.js';
export { PrincipleDistiller } from './skills/principle-distiller.js';

// Fitness (Phase 3)
export { computeHybridFitness, calibrateWeights } from './fitness/hybrid-fitness.js';
export { computeEngagementScore, isDismissiveReply, buildAutoMetrics, classifyUserIntent } from './fitness/implicit-fitness.js';
export type { UserIntent } from './fitness/implicit-fitness.js';
export { selfEvaluate, parseSelfEvalScore, correctSelfEvalBias } from './fitness/self-eval.js';
export { computeLocalEval, shouldCallLLMEval, DEFAULT_LLM_BUDGET } from './fitness/local-eval.js';
export type { LocalEvalResult, LLMBudget, LocalEvalOptions } from './fitness/local-eval.js';

// Embeddings (vector cognition)
export { OllamaEmbedder, SimpleEmbedder, cosineSimilarity, centroid, updateCentroid, createEmbedder } from './embeddings/embedder.js';
export type { Embedder } from './embeddings/embedder.js';
export { EmbeddingRouter } from './embeddings/embedding-router.js';
export type { StrategyProfile } from './embeddings/embedding-router.js';
export { ResponseHistory } from './embeddings/response-history.js';
export type { ResponseHistoryConfig } from './embeddings/response-history.js';

// Learning (Phase 4)
export {
  snapshotBirthWeights,
  computeRewardSignal,
  rewardModulatedUpdate,
  decayTowardBirth,
  lamarckianTransfer,
  learningMagnitude,
} from './learning/reward-learning.js';
export { consolidate } from './learning/consolidation.js';
export type { ConsolidationConfig, ConsolidationResult } from './learning/consolidation.js';

// Interactive Agent (Phase 5)
export { LivingAgent } from './agent/living-agent.js';
export { classifyTask } from './agent/task-classifier.js';
export { selectStrategy, scoreStrategy } from './agent/strategy-selector.js';
export type { SelectionConfig } from './agent/strategy-selector.js';
export type {
  TaskType,
  Interaction,
  LivingAgentConfig,
  AgentStatus,
} from './agent/interaction.js';
export {
  TASK_TYPES,
  DEFAULT_LIVING_AGENT_CONFIG,
} from './agent/interaction.js';

// Self-Coding Loop
export { SelfCodingLoop } from './self-coding/loop.js';
export { CodebaseAnalyzer } from './self-coding/analyzer.js';
export { PatchGenerator } from './self-coding/patch-generator.js';
export { GitSandbox } from './self-coding/sandbox.js';
export { Validator } from './self-coding/validator.js';
export { SelfCodingArchive } from './self-coding/archive.js';
export type {
  SelfCodingConfig,
  CodeIssue,
  CodePatch,
  PatchFile,
  PatchResult,
  TestResults,
  ValidationResult,
  CodingAttempt,
} from './self-coding/types.js';

// Classifier Memory
export { ClassifierMemory } from './agent/classifier-memory.js';

// Observability (optional Langfuse integration)
export { createLangfuseObserver, NoopObserver } from './observability/langfuse-observer.js';
export type { LangfuseObserver } from './observability/langfuse-observer.js';

// Shared utilities
export { hashString } from './core/utils.js';

// OpenClaw Integration (Phase 6)
export { createLivingAgentPlugin } from './integrations/openclaw/plugin.js';
export type {
  LivingAgentPlugin,
  OptimizedConfig,
  PrincipleInfo,
} from './integrations/openclaw/plugin.js';

// Safety (Escada 2.5)
export { BudgetTracker } from './safety/budget-cap.js';
export type { BudgetUsage, BudgetCheckResult } from './safety/budget-cap.js';
export { AuditLog } from './safety/audit-log.js';
export type { AuditFilter } from './safety/audit-log.js';
export { PROTECTED_PATHS, isProtectedPath, validatePatchPaths } from './safety/protected-files.js';
export { PopulationRollback, resetSnapshotCounter } from './safety/rollback.js';
export type { PopulationSnapshot } from './safety/rollback.js';
