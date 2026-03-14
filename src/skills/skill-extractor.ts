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

  /** Simple extraction: store the response pattern as a skill */
  private async extractSimple(task: Task, result: TaskResult): Promise<Skill> {
    const content = `For ${task.type} tasks: ${result.response.slice(0, 500)}`;
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
