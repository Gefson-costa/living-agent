// ================================================================
//  Codebase Analyzer — Identifies issues via tests + LLM analysis
//
//  Runs the test suite to find failures, reads source files in
//  focus areas, and uses LLM to identify potential improvements.
// ================================================================

import { readFile } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';

// fs.glob is experimental in Node 22+, not yet in @types/node
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const glob: (pattern: string, options?: { cwd?: string }) => AsyncIterable<string> =
  (fsp as unknown as Record<string, unknown>).glob as (pattern: string, options?: { cwd?: string }) => AsyncIterable<string>;
import type { LLMAdapter } from '../core/types.js';
import type { CodeIssue, SelfCodingConfig } from './types.js';
import { Validator } from './validator.js';

export class CodebaseAnalyzer {
  private config: SelfCodingConfig;
  private validator: Validator;
  private llm: LLMAdapter;

  constructor(config: SelfCodingConfig, validator: Validator) {
    this.config = config;
    this.validator = validator;
    this.llm = config.llm;
  }

  /** Orchestrate full analysis: test failures + LLM-detected issues */
  async analyze(): Promise<CodeIssue[]> {
    const issues: CodeIssue[] = [];

    // 1. Run tests and capture failures
    const testResults = await this.validator.runTests();
    if (testResults.failed > 0) {
      issues.push({
        type: 'test-failure',
        severity: 'high',
        file: 'tests/',
        description: `${testResults.failed} test(s) failing out of ${testResults.total}`,
      });
    }

    // 2. Collect source files matching focus areas
    const sourceFiles = await this.collectSourceFiles();

    // 3. Use LLM to analyze source for issues
    if (sourceFiles.length > 0) {
      const llmIssues = await this.analyzeWithLLM(sourceFiles);
      issues.push(...llmIssues);
    }

    // Sort by severity: high > medium > low
    const severityOrder = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return issues;
  }

  /** Collect source files matching focusAreas, excluding excludePatterns */
  private async collectSourceFiles(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    const excluded = new Set<string>();

    // Build exclusion set
    for (const pattern of this.config.excludePatterns) {
      try {
        for await (const entry of glob(pattern, { cwd: this.config.projectRoot })) {
          excluded.add(String(entry));
        }
      } catch {
        // glob pattern may not match anything
      }
    }

    // Collect matching files
    for (const pattern of this.config.focusAreas) {
      try {
        for await (const entry of glob(pattern, { cwd: this.config.projectRoot })) {
          const filePath = String(entry);
          if (excluded.has(filePath)) continue;
          try {
            const content = await readFile(`${this.config.projectRoot}/${filePath}`, 'utf-8');
            // Skip very large files
            if (content.length > 20_000) continue;
            files.push({ path: filePath, content });
          } catch {
            // File read error — skip
          }
        }
      } catch {
        // glob error
      }
    }

    return files;
  }

  /** Use LLM to analyze source files and identify issues */
  private async analyzeWithLLM(
    files: Array<{ path: string; content: string }>,
  ): Promise<CodeIssue[]> {
    // Limit context to avoid token overflow
    const fileContext = files
      .slice(0, 10)
      .map(f => `--- ${f.path} ---\n${f.content.slice(0, 3000)}`)
      .join('\n\n');

    const prompt = `Analyze these source files for potential issues. Focus on:
1. Dead code or unused parameters
2. Disconnected parameters (defined but never used in logic)
3. Missing error handling
4. Performance issues
5. Logic bugs

For each issue found, respond with a JSON array of objects:
[{"type": "bug"|"dead-code"|"disconnected-param"|"missing-test"|"performance", "severity": "high"|"medium"|"low", "file": "path/to/file.ts", "line": 42, "description": "...", "suggestedFix": "..."}]

If no issues found, respond with [].

Source files:
${fileContext}`;

    const response = await this.llm.execute(prompt, {
      temperature: 0.1,
      maxTokens: 2000,
      systemPrompt: 'You are a code review AI. Analyze code for issues. Respond only with a JSON array.',
      toolNames: [],
    });

    return this.parseLLMIssues(response.content);
  }

  /** Parse LLM response into CodeIssue[] */
  private parseLLMIssues(content: string): CodeIssue[] {
    try {
      // Extract JSON array from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed: Array<Record<string, unknown>> = JSON.parse(jsonMatch[0]);
      return parsed
        .filter(item => item.type && item.severity && item.file && item.description)
        .map(item => ({
          type: item.type as CodeIssue['type'],
          severity: item.severity as CodeIssue['severity'],
          file: item.file as string,
          line: (item.line as number | undefined) ?? undefined,
          description: item.description as string,
          suggestedFix: (item.suggestedFix as string | undefined) ?? undefined,
        }))
        .slice(0, 10); // Cap at 10 issues
    } catch {
      return [];
    }
  }
}
