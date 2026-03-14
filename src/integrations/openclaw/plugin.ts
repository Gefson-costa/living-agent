// ================================================================
//  OpenClaw Plugin — Living Agent integration
//
//  Exposes LivingAgent as a tool provider for OpenClaw agents.
//  Can also be used programmatically by any agent framework.
// ================================================================

import type { LLMAdapter, StorageAdapter, EngagementMetrics } from '../../core/types.js';
import { LivingAgent } from '../../agent/living-agent.js';
import type { LivingAgentConfig, AgentStatus } from '../../agent/interaction.js';
import { classifyTask } from '../../agent/task-classifier.js';
import { selectStrategy } from '../../agent/strategy-selector.js';
import { strategyToLLMConfig } from '../../llm/prompt-builder.js';

// ── Plugin interface for agent frameworks ─────────────────────

export interface LivingAgentPlugin {
  /** Initialize the plugin. Must be called before other methods. */
  init(): Promise<void>;

  /**
   * Get an optimized LLM config for a given user message.
   * Use this to let Living Agent select the best strategy
   * without handling the LLM call itself.
   */
  getOptimizedConfig(userMessage: string): OptimizedConfig;

  /**
   * Process a message end-to-end: classify, select strategy,
   * call LLM, self-evaluate, and update fitness.
   */
  chat(userMessage: string): Promise<string>;

  /** Apply user feedback (0-10) to the last interaction. */
  feedback(score: number): Promise<boolean>;

  /** Report external engagement signals for the pending interaction. */
  reportEngagement(signals: Partial<Pick<EngagementMetrics, 'emojiReaction' | 'blocked' | 'readButIgnored'>>): void;

  /** Report that the user did not reply (timeout). */
  reportNoReply(): Promise<void>;

  /** Get agent status. */
  status(): Promise<AgentStatus>;

  /** Get learned principles. */
  principles(): Promise<PrincipleInfo[]>;

  /** Trigger consolidation manually. */
  consolidate(): Promise<void>;

  /** Save state. */
  save(): Promise<void>;
}

export interface OptimizedConfig {
  taskType: string;
  strategyId: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  toolNames: string[];
  fitness: number;
  expertise: number;
}

export interface PrincipleInfo {
  taskTypes: string[];
  content: string;
  fitness: number;
}

// ── Factory ───────────────────────────────────────────────────

/**
 * Create a LivingAgentPlugin instance.
 *
 * Usage with OpenClaw or any agent framework:
 *
 * ```ts
 * import { createLivingAgentPlugin } from 'living-agent/integrations/openclaw';
 *
 * const plugin = createLivingAgentPlugin(llmAdapter, store, {
 *   strategyCount: 8,
 *   consolidateEvery: 20,
 * });
 * await plugin.init();
 *
 * // Option 1: Full chat (Living Agent handles LLM call)
 * const response = await plugin.chat("Write a sort function");
 *
 * // Option 2: Just get optimized config (you handle the LLM call)
 * const config = plugin.getOptimizedConfig("Write a sort function");
 * const response = await yourLLM.execute(message, config);
 * ```
 */
export function createLivingAgentPlugin(
  llm: LLMAdapter,
  store: StorageAdapter,
  config: Partial<LivingAgentConfig> = {},
): LivingAgentPlugin {
  const agent = new LivingAgent(llm, store, config);

  return {
    async init() {
      await agent.init();
    },

    getOptimizedConfig(userMessage: string): OptimizedConfig {
      const taskType = classifyTask(userMessage);
      const strategies = agent.getStrategies();
      const strategy = selectStrategy(strategies, taskType, { epsilon: 0 });

      const llmConfig = strategyToLLMConfig(
        strategy,
        config.systemPromptTemplate ?? 'You are a helpful AI assistant. Solve the given task.',
        config.toolNames ?? ['search', 'code', 'analyze', 'summarize'],
      );

      return {
        taskType,
        strategyId: strategy.genome.id,
        temperature: llmConfig.temperature,
        maxTokens: llmConfig.maxTokens,
        systemPrompt: llmConfig.systemPrompt,
        toolNames: llmConfig.toolNames,
        fitness: strategy.fitness,
        expertise: strategy.taskTypeMemory.get(taskType) ?? 0.5,
      };
    },

    async chat(userMessage: string) {
      return agent.chat(userMessage);
    },

    async feedback(score: number) {
      return agent.applyFeedback(score);
    },

    reportEngagement(signals) {
      agent.reportEngagement(signals);
    },

    async reportNoReply() {
      return agent.reportNoReply();
    },

    async status() {
      return agent.getFullStatus();
    },

    async principles() {
      const skills = await agent.getSkills();
      return skills
        .filter(s => s.type === 'principle')
        .map(s => ({
          taskTypes: s.taskTypes,
          content: s.content,
          fitness: s.fitness,
        }));
    },

    async consolidate() {
      return agent.runConsolidation();
    },

    async save() {
      return agent.save();
    },
  };
}
