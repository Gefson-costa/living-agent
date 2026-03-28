// ================================================================
//  Prompt Builder — Strategy-aware prompt construction
//
//  Constructs prompts incorporating skill references, task-type
//  expertise, reasoning depth, prompt segments, and few-shot
//  exemplars with token budget awareness.
// ================================================================

import type { StrategyGenome, Strategy, Skill, LLMConfig } from '../core/types.js';
import { buildSystemPrompt } from './adapter.js';
import type { Exemplar } from '../learning/exemplar-store.js';

/** Rough token estimate: ~4 chars per token */
const CHARS_PER_TOKEN = 4;
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Fraction of maxTokenBudget reserved for skills + exemplars */
const CONTEXT_BUDGET_FRACTION = 0.20;

export interface PromptBuildOptions {
  skills?: Skill[];
  exemplars?: Exemplar[];
}

export function buildStrategyPrompt(
  template: string,
  strategy: Strategy,
  toolNames: string[],
  options: PromptBuildOptions = {},
): string {
  const { skills = [], exemplars = [] } = options;

  let prompt = buildSystemPrompt(template, strategy.genome, toolNames, strategy.taskTypeMemory);

  // Inject evolved prompt segments (EvoPrompt-style)
  const segments = strategy.genome.promptSegments ?? [];
  if (segments.length > 0) {
    prompt += '\n\n' + segments.join('\n');
  }

  // Token budget for skills + exemplars combined
  const totalBudget = Math.floor(strategy.genome.maxTokenBudget * CONTEXT_BUDGET_FRACTION);
  let budgetUsed = 0;

  // Inject skills (greedy, respecting budget)
  if (skills.length > 0) {
    const skillLines: string[] = [];
    for (const skill of skills) {
      const line = skill.type === 'principle'
        ? `Principle: ${skill.content}`
        : `Skill [${skill.taskTypes.join(',')}]: ${skill.content}`;
      const tokens = estimateTokens(line);
      if (budgetUsed + tokens > totalBudget) break;
      skillLines.push(line);
      budgetUsed += tokens;
    }
    if (skillLines.length > 0) {
      prompt += '\n\nLearned knowledge:\n' + skillLines.join('\n');
    }
  }

  // Inject few-shot exemplars (remaining budget)
  if (exemplars.length > 0) {
    const exemplarLines: string[] = [];
    for (const ex of exemplars) {
      const block = `Example:\nQ: ${ex.taskPrompt}\nA: ${ex.response}`;
      const tokens = estimateTokens(block);
      if (budgetUsed + tokens > totalBudget) break;
      exemplarLines.push(block);
      budgetUsed += tokens;
    }
    if (exemplarLines.length > 0) {
      prompt += '\n\nFew-shot examples:\n' + exemplarLines.join('\n\n');
    }
  }

  return prompt;
}

export function strategyToLLMConfig(
  strategy: Strategy,
  systemPromptTemplate: string,
  toolNames: string[],
  options: PromptBuildOptions = {},
): LLMConfig {
  return {
    temperature: strategy.genome.temperature,
    maxTokens: strategy.genome.maxTokenBudget,
    systemPrompt: buildStrategyPrompt(systemPromptTemplate, strategy, toolNames, options),
    toolNames,
  };
}
