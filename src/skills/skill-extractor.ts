// ================================================================
//  Skill Extractor — Extract skills from successful task chains
//
//  After a successful task (score > threshold), optionally uses LLM
//  to extract a reusable skill pattern from the response.
// ================================================================

import type { LLMAdapter, TaskResult, Task, Skill } from '../core/types.js';
import { SkillLibrary } from './skill-library.js';

export interface SkillExtractorConfig {
  scoreThreshold: number;    // minimum score to trigger extraction (default 0.8)
  llmExtraction: boolean;    // use LLM for smart extraction (default false for mock)
}

const DEFAULT_CONFIG: SkillExtractorConfig = {
  scoreThreshold: 0.8,
  llmExtraction: false,
};

export class SkillExtractor {
  private config: SkillExtractorConfig;
  private library: SkillLibrary;
  private llm?: LLMAdapter;

  constructor(library: SkillLibrary, llm?: LLMAdapter, config: Partial<SkillExtractorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.library = library;
    this.llm = llm;
  }

  /** Try to extract a skill from a successful task result */
  async tryExtract(task: Task, result: TaskResult): Promise<Skill | null> {
    if (result.score < this.config.scoreThreshold) return null;

    if (this.config.llmExtraction && this.llm) {
      return this.extractWithLLM(task, result);
    }

    return this.extractSimple(task, result);
  }

  /** Simple extraction: extract structural patterns from high-scoring responses */
  private async extractSimple(task: Task, result: TaskResult): Promise<Skill | null> {
    const response = result.response.trim();

    // Skip too-short or conversational responses (likely not real skills)
    if (response.length < 50) return null;

    // Extract structural signals: steps, code blocks, key reasoning patterns
    const patterns: string[] = [];

    // Look for numbered steps / bullet points
    const stepLines = response.split('\n').filter(l => /^\s*(\d+[\.\):]|[-*•])/.test(l));
    if (stepLines.length >= 2) {
      patterns.push('Approach: ' + stepLines.slice(0, 5).map(l => l.trim()).join(' → '));
    }

    // Look for code blocks
    const codeBlocks = response.match(/```[\s\S]*?```/g);
    if (codeBlocks && codeBlocks.length > 0) {
      const firstBlock = codeBlocks[0].slice(0, 300);
      patterns.push('Code pattern: ' + firstBlock);
    }

    // Look for reasoning markers ("because", "therefore", "step", "first")
    const reasoningLines = response.split('\n').filter(l =>
      /\b(because|therefore|first|then|finally|key insight|the trick|approach)\b/i.test(l)
    );
    if (reasoningLines.length > 0) {
      patterns.push('Reasoning: ' + reasoningLines.slice(0, 3).map(l => l.trim()).join(' | '));
    }

    // If no structural patterns found, skip — raw text is not a useful skill
    if (patterns.length === 0) return null;

    const content = `[${task.type}] ${patterns.join('\n')}`.slice(0, 500);
    return this.library.addSkill('code', [task.type], content, result.score);
  }

  /** LLM-powered extraction: ask LLM to identify the reusable pattern */
  private async extractWithLLM(task: Task, result: TaskResult): Promise<Skill | null> {
    if (!this.llm) return null;

    const extractionPrompt = `Given this task and successful response, extract a reusable skill or pattern.

Task type: ${task.type}
Task: ${task.prompt}
Response: ${result.response}
Score: ${result.score}

Extract a concise, reusable principle or code pattern. Reply with just the skill content.`;

    const response = await this.llm.execute(extractionPrompt, {
      temperature: 0.1,
      maxTokens: 300,
      systemPrompt: 'Extract reusable skills from successful task completions.',
      toolNames: [],
    });

    if (response.content.length < 10) return null;

    return this.library.addSkill('code', [task.type], response.content, result.score);
  }
}
