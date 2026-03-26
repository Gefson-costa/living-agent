// ================================================================
//  Patch Generator — LLM-powered code patch generation
//
//  Given a CodeIssue and relevant source context, generates a
//  CodePatch with before/after file contents.
// ================================================================

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

  /** Generate multiple patch candidates for a given issue (Tree Search) */
  async generatePatchCandidates(
    issue: CodeIssue,
    contextFiles: Array<{ path: string; content: string }>,
    count: number = 3,
  ): Promise<CodePatch[]> {
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
    const baseTemperature = this.genome
      ? Math.min(0.4, this.genome.temperature * 0.4)  // constrain for code: max 0.4
      : 0.1;

    let systemPrompt = 'You are a code repair AI. Generate precise, minimal patches as JSON. Include complete file contents.';
    if (this.genome && this.genome.reasoningDepth > 0.6) {
      systemPrompt += '\nThink step-by-step about the root cause before generating the fix.';
    }

    const promises = Array.from({ length: count }).map((_, index) => {
      // Jitter temperature slightly to encourage diverse candidates
      const temperature = Math.min(1.0, baseTemperature + (index * 0.15));
      return this.llm.execute(prompt, {
        temperature,
        maxTokens: 4000,
        systemPrompt,
        toolNames: [],
      });
    });

    const responses = await Promise.all(promises);
    const validPatches: CodePatch[] = [];

    for (const response of responses) {
      const patchFiles = this.parsePatchResponse(response.content, contextFiles);
      if (patchFiles.length > 0) {
        const patchId = `patch_${++patchCounter}_${Date.now()}`;
        validPatches.push({
          id: patchId,
          issue,
          files: patchFiles,
          description: this.extractDescription(response.content) ?? `Fix: ${issue.description}`,
        });
      }
    }

    // Deduplicate identical patches based on modified file contents
    const uniquePatches: CodePatch[] = [];
    const seenContents = new Set<string>();

    for (const patch of validPatches) {
      // Hash based on file paths and modified contents
      const hash = patch.files.map(f => `${f.path}:${f.modified}`).join('|');
      if (!seenContents.has(hash)) {
        seenContents.add(hash);
        uniquePatches.push(patch);
      }
    }

    return uniquePatches;
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
