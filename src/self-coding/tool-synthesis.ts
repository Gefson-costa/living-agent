// ================================================================
//  Tool Synthesis — Generates new tools when agent is struggling
//
//  Flow: diagnoseGap → synthesize → validate → register
//  Detects persistent low fitness for a task type, identifies the
//  missing capability, generates a TypeScript tool, validates it
//  compiles, and registers it for use.
// ================================================================

import { writeFile, mkdir } from 'node:fs/promises';
import type { LLMAdapter, TaskResult } from '../core/types.js';

export interface SynthesizedTool {
  name: string;
  description: string;
  code: string;
  filePath: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  fitnessImpact: number;
  createdBy: string;       // strategy genome ID that triggered synthesis
  createdAt: number;
}

export interface GapDiagnosis {
  taskType: string;
  missingCapability: string;
  suggestedToolName: string;
  rationale: string;
}

export class ToolSynthesizer {
  private llm: LLMAdapter;
  private toolsDir: string;
  private projectRoot: string;

  constructor(llm: LLMAdapter, projectRoot: string, toolsDir = 'src/skills/tools') {
    this.llm = llm;
    this.projectRoot = projectRoot;
    this.toolsDir = `${projectRoot}/${toolsDir}`;
  }

  /**
   * Step 1: Diagnose what capability is missing for a struggling task type.
   * Analyzes recent failed results to identify the bottleneck.
   * Returns null if no clear gap is identified.
   */
  async diagnoseGap(taskType: string, failedResults: TaskResult[]): Promise<GapDiagnosis | null> {
    const summaries = failedResults.slice(-10).map((r, i) =>
      `${i + 1}. Task: "${r.taskId}" | Score: ${r.score.toFixed(2)} | Response snippet: "${r.response.slice(0, 200)}"`
    ).join('\n');

    const prompt = `The agent consistently scores low on tasks of type "${taskType}".
Here are the last ${failedResults.length} attempts:

${summaries}

Analyze these results. What capability is the agent missing?
Common gaps: file access, web search, code execution, data parsing, math computation, text extraction, API access.

If you can identify a clear missing capability that a new tool could solve, respond with JSON:
{
  "missingCapability": "description of what's missing",
  "suggestedToolName": "snake_case_name",
  "rationale": "why this tool would help"
}

If the failures are not due to a missing tool (e.g., the model just needs better prompts), respond with: {"noGap": true}`;

    const response = await this.llm.execute(prompt, {
      temperature: 0.1,
      maxTokens: 1000,
      systemPrompt: 'You are an AI diagnostician analyzing agent failures to identify missing capabilities.',
      toolNames: [],
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const data = JSON.parse(jsonMatch[0]);
      if (data.noGap || !data.missingCapability) return null;

      return {
        taskType,
        missingCapability: data.missingCapability,
        suggestedToolName: data.suggestedToolName ?? `${taskType}_helper`,
        rationale: data.rationale ?? '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Step 2: Synthesize a tool based on a diagnosed gap.
   * Generates TypeScript code, validates it compiles, writes to disk.
   */
  async synthesize(gap: GapDiagnosis, strategyId: string): Promise<SynthesizedTool | null> {
    const prompt = `Create a TypeScript tool to fill this capability gap:

Gap: ${gap.missingCapability}
Suggested name: ${gap.suggestedToolName}
Rationale: ${gap.rationale}

The tool MUST follow this exact interface:
- export const name: string
- export const description: string
- export const inputSchema: object (JSON Schema describing the args)
- export const outputSchema: object (JSON Schema describing the return)
- export async function execute(args: Record<string, unknown>): Promise<unknown>

Only use standard Node.js libraries (fs, path, crypto, http, url, etc.). No external dependencies.
The tool must be safe: no shell execution, no network access to arbitrary URLs, no file deletion.

Response format MUST be a strict JSON object:
{
  "name": "${gap.suggestedToolName}",
  "description": "What the tool does",
  "inputSchema": { "type": "object", "properties": { ... } },
  "outputSchema": { "type": "object", "properties": { ... } },
  "code": "full TypeScript source code as a single string"
}`;

    const response = await this.llm.execute(prompt, {
      temperature: 0.2,
      maxTokens: 3000,
      systemPrompt: 'You are an elite TypeScript developer generating safe, focused agent tools.',
      toolNames: [],
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const data = JSON.parse(jsonMatch[0]);
      if (!data.name || !data.code) return null;

      // Validate: code must not contain dangerous patterns
      if (!this.validateToolSafety(data.code)) return null;

      const sanitizedName = String(data.name).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
      const filename = `${sanitizedName}.ts`;
      const absolutePath = `${this.toolsDir}/${filename}`;

      // Ensure directory exists and write tool
      await mkdir(this.toolsDir, { recursive: true });
      await writeFile(absolutePath, data.code, 'utf-8');

      return {
        name: data.name,
        description: data.description ?? gap.missingCapability,
        code: data.code,
        filePath: absolutePath,
        inputSchema: data.inputSchema ?? {},
        outputSchema: data.outputSchema ?? {},
        fitnessImpact: 0,    // tracked over time after usage
        createdBy: strategyId,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Convenience: diagnose + synthesize in one call.
   * Used by the simpler integration path in living-agent.
   */
  async synthesizeTool(
    taskType: string,
    examplePrompt: string,
    strategyId = 'unknown',
  ): Promise<SynthesizedTool | null> {
    // Build a minimal TaskResult for diagnosis
    const fakeResult: TaskResult = {
      taskId: 'synthesis-trigger',
      strategyId,
      score: 0.1,
      tokensUsed: 0,
      latencyMs: 0,
      response: `Low-scoring response to: ${examplePrompt}`,
      success: false,
      taskType,
    };

    const gap = await this.diagnoseGap(taskType, [fakeResult]);
    if (!gap) {
      // Fallback: try direct synthesis without diagnosis
      return this.synthesizeDirect(taskType, examplePrompt, strategyId);
    }

    return this.synthesize(gap, strategyId);
  }

  /**
   * Direct synthesis without gap diagnosis (fallback path).
   */
  private async synthesizeDirect(
    taskType: string,
    examplePrompt: string,
    strategyId: string,
  ): Promise<SynthesizedTool | null> {
    const prompt = `The agent is struggling to solve tasks of type "${taskType}".
Example prompt that scored low: "${examplePrompt}"

To help the agent, you must synthesize a new TypeScript tool.
The tool should export a 'name', 'description', and an 'execute(args)' function.
Only use standard Node.js libraries (fs, crypto, http, etc.) or assume zero dependencies.

Response format MUST be a strict JSON object:
{
  "name": "tool_name",
  "description": "What the tool does, and arguments it expects",
  "code": "export const name = 'tool_name';\\nexport const description = '...';\\nexport async function execute(args: any) { ... }"
}`;

    const response = await this.llm.execute(prompt, {
      temperature: 0.2,
      maxTokens: 2000,
      systemPrompt: 'You are an elite TypeScript developer generating agent tools.',
      toolNames: [],
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const data = JSON.parse(jsonMatch[0]);
      if (!data.name || !data.code) return null;

      if (!this.validateToolSafety(data.code)) return null;

      const sanitizedName = String(data.name).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
      const filename = `${sanitizedName}.ts`;
      const absolutePath = `${this.toolsDir}/${filename}`;

      await mkdir(this.toolsDir, { recursive: true });
      await writeFile(absolutePath, data.code, 'utf-8');

      return {
        name: data.name,
        description: data.description ?? '',
        code: data.code,
        filePath: absolutePath,
        inputSchema: {},
        outputSchema: {},
        fitnessImpact: 0,
        createdBy: strategyId,
        createdAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Basic safety validation: reject code with dangerous patterns.
   * This is a first-pass filter — real sandbox validation would run the code in isolation.
   */
  private validateToolSafety(code: string): boolean {
    const dangerousPatterns = [
      /child_process/,            // shell execution
      /eval\s*\(/,                // eval
      /Function\s*\(/,            // Function constructor
      /process\.exit/,            // process termination
      /require\s*\(\s*['"`]/,     // CJS require (ESM only)
      /rm\s*-rf/i,                // destructive shell pattern in strings
      /unlink\s*\(/,              // file deletion
      /rmdir\s*\(/,               // directory deletion
    ];

    return !dangerousPatterns.some(pattern => pattern.test(code));
  }
}
