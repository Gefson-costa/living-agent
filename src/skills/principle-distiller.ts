// ================================================================
//  Principle Distiller — ExpeL-style rule extraction
//
//  Periodically reviews experience history to extract general
//  principles from patterns in high vs low-scoring responses.
// ================================================================

import type { LLMAdapter, StorageAdapter, Skill } from '../core/types.js';
import { SkillLibrary } from './skill-library.js';

export interface DistillerConfig {
  minExperiences: number;    // minimum experiences before distillation (default 10)
  topN: number;              // number of top/bottom experiences to compare (default 5)
  llmDistillation: boolean;  // use LLM for smart distillation (default false)
}

const DEFAULT_CONFIG: DistillerConfig = {
  minExperiences: 10,
  topN: 5,
  llmDistillation: false,
};

export class PrincipleDistiller {
  private config: DistillerConfig;
  private library: SkillLibrary;
  private store: StorageAdapter;
  private llm?: LLMAdapter;

  constructor(
    library: SkillLibrary,
    store: StorageAdapter,
    llm?: LLMAdapter,
    config: Partial<DistillerConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.library = library;
    this.store = store;
    this.llm = llm;
  }

  /** Distill principles from experience history for a given task type */
  async distill(taskType: string): Promise<Skill | null> {
    const experiences = await this.store.queryExperiences({ taskType });
    if (experiences.length < this.config.minExperiences) return null;

    // Sort by score
    const sorted = [...experiences].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, this.config.topN);
    const bottom = sorted.slice(-this.config.topN);

    if (this.config.llmDistillation && this.llm) {
      return this.distillWithLLM(taskType, top, bottom);
    }

    return this.distillSimple(taskType, top, bottom);
  }

  /** Simple distillation: extract statistical and structural patterns */
  private async distillSimple(
    taskType: string,
    top: { score: number; response: string; tokensUsed: number }[],
    bottom: { score: number; response: string; tokensUsed: number }[],
  ): Promise<Skill> {
    const avgTopTokens = top.reduce((s, e) => s + e.tokensUsed, 0) / top.length;
    const avgBottomTokens = bottom.reduce((s, e) => s + e.tokensUsed, 0) / bottom.length;
    const avgTopLength = top.reduce((s, e) => s + e.response.length, 0) / top.length;
    const avgBottomLength = bottom.reduce((s, e) => s + e.response.length, 0) / bottom.length;

    const principles: string[] = [];

    // Token efficiency pattern
    if (avgTopTokens < avgBottomTokens * 0.8) {
      principles.push('Use fewer tokens for better results.');
    }

    // Response length pattern
    if (avgTopLength < avgBottomLength * 0.7) {
      principles.push('Shorter responses tend to score higher.');
    } else if (avgTopLength > avgBottomLength * 1.3) {
      principles.push('More detailed responses tend to score higher.');
    }

    // Structure patterns: numbered lists, bullet points, code blocks
    const topStructured = countPattern(top.map(e => e.response), /^\s*(\d+[.)]\s|[-*]\s)/m);
    const bottomStructured = countPattern(bottom.map(e => e.response), /^\s*(\d+[.)]\s|[-*]\s)/m);
    if (topStructured > bottomStructured + 1) {
      principles.push('Structured responses (lists, steps) score higher.');
    } else if (bottomStructured > topStructured + 1) {
      principles.push('Prose-style responses score higher than lists.');
    }

    // Code block pattern
    const topCode = countPattern(top.map(e => e.response), /```/);
    const bottomCode = countPattern(bottom.map(e => e.response), /```/);
    if (topCode > bottomCode + 1) {
      principles.push('Including code examples improves scores.');
    }

    // Reasoning pattern: step-by-step, causal markers
    const reasoningMarkers = /\b(step|because|therefore|first|then|finally|reason|since)\b/i;
    const topReasoning = countPattern(top.map(e => e.response), reasoningMarkers);
    const bottomReasoning = countPattern(bottom.map(e => e.response), reasoningMarkers);
    if (topReasoning > bottomReasoning + 1) {
      principles.push('Explicit reasoning (step-by-step, causal language) improves scores.');
    }

    // Word complexity: average word length as proxy
    const topAvgWordLen = avgWordLength(top.map(e => e.response));
    const bottomAvgWordLen = avgWordLength(bottom.map(e => e.response));
    if (topAvgWordLen > bottomAvgWordLen * 1.15) {
      principles.push('Technical/precise vocabulary correlates with higher scores.');
    } else if (topAvgWordLen < bottomAvgWordLen * 0.85) {
      principles.push('Simpler vocabulary correlates with higher scores.');
    }

    principles.push(`Top score range: ${top[top.length - 1].score.toFixed(2)}-${top[0].score.toFixed(2)}`);

    const content = `[${taskType}] ${principles.join(' ')}`;
    const avgTopScore = top.reduce((s, e) => s + e.score, 0) / top.length;
    return this.library.addSkill('principle', [taskType], content, avgTopScore * 0.8);
  }

  /** LLM-powered distillation: compare success vs failure patterns */
  private async distillWithLLM(
    taskType: string,
    top: { score: number; response: string; taskPrompt: string }[],
    bottom: { score: number; response: string; taskPrompt: string }[],
  ): Promise<Skill | null> {
    if (!this.llm) return null;

    const successExamples = top.map(e => `Score ${e.score.toFixed(2)}: "${e.response.slice(0, 200)}"`).join('\n');
    const failureExamples = bottom.map(e => `Score ${e.score.toFixed(2)}: "${e.response.slice(0, 200)}"`).join('\n');

    const distillPrompt = `Analyze these ${taskType} task attempts and extract a general principle.

SUCCESSFUL attempts:
${successExamples}

FAILED attempts:
${failureExamples}

What pattern distinguishes success from failure? Reply with one concise principle.`;

    const response = await this.llm.execute(distillPrompt, {
      temperature: 0.1,
      maxTokens: 200,
      systemPrompt: 'Extract principles from experience patterns.',
      toolNames: [],
    });

    if (response.content.length < 10) return null;

    const avgTopScore = top.reduce((s, e) => s + e.score, 0) / top.length;
    return this.library.addSkill('principle', [taskType], response.content, avgTopScore * 0.8);
  }
}

/** Count how many responses match a pattern */
function countPattern(responses: string[], pattern: RegExp): number {
  return responses.filter(r => pattern.test(r)).length;
}

/** Compute average word length across responses (proxy for vocabulary complexity) */
function avgWordLength(responses: string[]): number {
  let totalLen = 0;
  let totalWords = 0;
  for (const r of responses) {
    const words = r.split(/\s+/).filter(w => w.length > 0);
    for (const w of words) totalLen += w.length;
    totalWords += words.length;
  }
  return totalWords > 0 ? totalLen / totalWords : 0;
}
