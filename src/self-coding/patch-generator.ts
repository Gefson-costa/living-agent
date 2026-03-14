// ================================================================
//  Patch Generator — LLM-powered code patch generation
//
//  Given a CodeIssue and relevant source context, generates a
//  CodePatch with before/after file contents.
// ================================================================

import { readFile } from 'node:fs/promises';
import type { LLMAdapter, StrategyGenome } from '../core/types.js';
import type { CodeIssue, CodePatch, PatchFile } from './types.js';

let patchCounter = 0;

export function resetPatchCounter(): void {
  patchCounter = 0;
}

export class PatchGenerator {
  private llm: LLMAdapter;
  private projectRoot: string;
  private genome?: StrategyGenome;

  constructor(llm: LLMAdapter, projectRoot: string, genome?: StrategyGenome) {
    this.llm = llm;
    this.projectRoot = projectRoot;
    this.genome = genome;
  }

  /** Generate a patch for a given issue with surrounding file context */
  async generatePatch(
    issue: CodeIssue,
    contextFiles: Array<{ path: string; content: string }>,
  ): Promise<CodePatch> {
    const patchId = `patch_${++patchCounter}_${Date.now()}`;

    const fileContext = contextFiles
      .map(f => `--- ${f.path} ---\n${f.content}`)
      .join('\n\n');

    const prompt = `Fix the following issue in the codebase:

Issue type: ${issue.type}
Severity: ${issue.severity}
File: ${issue.file}${issue.line ? ` (line ${issue.line})` : ''}
Description: ${issue.description}
${issue.suggestedFix ? `Suggested fix: ${issue.suggestedFix}` : ''}

Relevant source files:
${fileContext}

Respond with a JSON object containing the fix:
{
  "description": "Brief description of what the patch does",
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "original": "exact content of the original file",
      "modified": "exact content of the modified file"
    }
  ]
}

IMPORTANT:
- Include the COMPLETE file content in both "original" and "modified" fields
- Only modify files that need changing
- Make minimal, focused changes
- Do not modify files in src/self-coding/`;

    // Use evolved genome parameters when available
    const temperature = this.genome
      ? Math.min(0.4, this.genome.temperature * 0.4)  // constrain for code: max 0.4
      : 0.1;

    let systemPrompt = 'You are a code repair AI. Generate precise, minimal patches as JSON. Include complete file contents.';
    if (this.genome && this.genome.reasoningDepth > 0.6) {
      systemPrompt += '\nThink step-by-step about the root cause before generating the fix.';
    }

    const response = await this.llm.execute(prompt, {
      temperature,
      maxTokens: 4000,
      systemPrompt,
      toolNames: [],
    });

    const patchFiles = this.parsePatchResponse(response.content, contextFiles);

    return {
      id: patchId,
      issue,
      files: patchFiles,
      description: this.extractDescription(response.content) ?? `Fix: ${issue.description}`,
    };
  }

  /** Read a file from the project */
  async readFile(relativePath: string): Promise<string> {
    return readFile(`${this.projectRoot}/${relativePath}`, 'utf-8');
  }

  private parsePatchResponse(
    content: string,
    contextFiles: Array<{ path: string; content: string }>,
  ): PatchFile[] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*"files"[\s\S]*\}/);
      if (!jsonMatch) return [];

      const data = JSON.parse(jsonMatch[0]);
      const files = data.files as any[];

      return files
        .filter(f => f.path && f.modified)
        .map(f => {
          // Use actual file content as original if not provided
          const contextFile = contextFiles.find(cf => cf.path === f.path);
          return {
            path: f.path,
            original: f.original ?? contextFile?.content ?? '',
            modified: f.modified,
          };
        })
        .filter(f => f.original !== f.modified); // Only include actual changes
    } catch {
      return [];
    }
  }

  private extractDescription(content: string): string | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*"description"[\s\S]*\}/);
      if (!jsonMatch) return null;
      const data = JSON.parse(jsonMatch[0]);
      return data.description ?? null;
    } catch {
      return null;
    }
  }
}
