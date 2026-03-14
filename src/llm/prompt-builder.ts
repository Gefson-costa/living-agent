// ================================================================
//  Prompt Builder — Strategy-aware prompt construction
//
//  Constructs prompts incorporating skill references, task-type
//  expertise, and reasoning depth configuration.
// ================================================================

import type { StrategyGenome, Strategy, Skill, LLMConfig } from '../core/types.js';
import { buildSystemPrompt } from './adapter.js';

export function buildStrategyPrompt(
  template: string,
  strategy: Strategy,
  toolNames: string[],
  skills: Skill[] = [],
): string {
  let prompt = buildSystemPrompt(template, strategy.genome, toolNames, strategy.taskTypeMemory);

  // Inject active skills
  if (skills.length > 0) {
    const skillLines: string[] = [];
    for (const skill of skills) {
      if (skill.type === 'principle') {
        skillLines.push(`Principle: ${skill.content}`);
      } else {
        skillLines.push(`Skill [${skill.taskTypes.join(',')}]: ${skill.content}`);
      }
    }
    if (skillLines.length > 0) {
      prompt += '\n\nLearned knowledge:\n' + skillLines.join('\n');
    }
  }

  return prompt;
}

export function strategyToLLMConfig(
  strategy: Strategy,
  systemPromptTemplate: string,
  toolNames: string[],
  skills: Skill[] = [],
): LLMConfig {
  return {
    temperature: strategy.genome.temperature,
    maxTokens: strategy.genome.maxTokenBudget,
    systemPrompt: buildStrategyPrompt(systemPromptTemplate, strategy, toolNames, skills),
    toolNames,
  };
}
