import { describe, it, expect, afterEach } from 'vitest';
import { ToolSynthesizer } from '../../src/self-coding/tool-synthesis.js';
import type { LLMAdapter, LLMConfig, LLMResponse, TaskResult } from '../../src/core/types.js';
import { rm } from 'node:fs/promises';

// ── Mock LLM ────────────────────────────────────────────────────

class MockToolLLM implements LLMAdapter {
  calls: string[] = [];

  async execute(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    this.calls.push(prompt.slice(0, 80));

    // Gap diagnosis mock
    if (prompt.includes('consistently scores low')) {
      if (prompt.includes('no-gap')) {
        return { content: '{"noGap": true}', tokensUsed: 20, latencyMs: 50 };
      }
      return {
        content: JSON.stringify({
          missingCapability: 'Math computation',
          suggestedToolName: 'calculator_tool',
          rationale: 'Agent cannot do arithmetic',
        }),
        tokensUsed: 50,
        latencyMs: 50,
      };
    }

    // Synthesis mock
    if (prompt.includes('capability gap') || prompt.includes('struggling to solve')) {
      if (prompt.includes('evil_tool') || prompt.includes('Shell access')) {
        // Return code with dangerous pattern
        return {
          content: JSON.stringify({
            name: 'evil_tool',
            description: 'Bad tool',
            code: 'import { exec } from "child_process"; export const name = "evil";',
          }),
          tokensUsed: 100,
          latencyMs: 100,
        };
      }

      const code = [
        'export const name = "calculator_tool";',
        'export const description = "Calculates things";',
        'export const inputSchema = { type: "object", properties: { expression: { type: "string" } } };',
        'export const outputSchema = { type: "object", properties: { result: { type: "number" } } };',
        'export async function execute(args: Record<string, unknown>) { return { result: 42 }; }',
      ].join('\n');

      return {
        content: JSON.stringify({
          name: 'calculator_tool',
          description: 'Calculates things',
          inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
          outputSchema: { type: 'object', properties: { result: { type: 'number' } } },
          code,
        }),
        tokensUsed: 100,
        latencyMs: 100,
      };
    }

    return { content: 'I cannot do that.', tokensUsed: 10, latencyMs: 50 };
  }
}

// ── Tests ────────────────────────────────────────────────────────

const toolsDir = 'test-tools-output';

describe('ToolSynthesizer', () => {
  const llm = new MockToolLLM();
  const synthesizer = new ToolSynthesizer(llm, process.cwd(), toolsDir);

  afterEach(async () => {
    try { await rm(`${process.cwd()}/${toolsDir}`, { recursive: true, force: true }); } catch {}
    llm.calls = [];
  });

  describe('diagnoseGap', () => {
    it('identifies a missing capability from failed results', async () => {
      const failedResults: TaskResult[] = [
        { taskId: 't1', strategyId: 's1', score: 0.1, tokensUsed: 100, latencyMs: 50, response: 'I tried but got it wrong', success: false, taskType: 'math' },
        { taskId: 't2', strategyId: 's1', score: 0.2, tokensUsed: 100, latencyMs: 50, response: 'Cannot compute 2+2', success: false, taskType: 'math' },
      ];

      const gap = await synthesizer.diagnoseGap('math', failedResults);

      expect(gap).not.toBeNull();
      expect(gap!.taskType).toBe('math');
      expect(gap!.missingCapability).toBe('Math computation');
      expect(gap!.suggestedToolName).toBe('calculator_tool');
    });

    it('returns null when no gap is identified', async () => {
      const failedResults: TaskResult[] = [
        { taskId: 't1', strategyId: 's1', score: 0.1, tokensUsed: 100, latencyMs: 50, response: 'bad', success: false, taskType: 'no-gap' },
      ];

      const gap = await synthesizer.diagnoseGap('no-gap', failedResults);
      expect(gap).toBeNull();
    });
  });

  describe('synthesize', () => {
    it('generates a tool from a gap diagnosis and writes to disk', async () => {
      const gap = {
        taskType: 'math',
        missingCapability: 'Math computation',
        suggestedToolName: 'calculator_tool',
        rationale: 'Agent cannot do arithmetic',
      };

      const tool = await synthesizer.synthesize(gap, 'strategy_1');

      expect(tool).not.toBeNull();
      expect(tool!.name).toBe('calculator_tool');
      expect(tool!.createdBy).toBe('strategy_1');
      expect(tool!.createdAt).toBeGreaterThan(0);
      expect(tool!.fitnessImpact).toBe(0);
      expect(tool!.inputSchema).toHaveProperty('type');
      expect(tool!.code).toContain('export async function execute');
      expect(tool!.filePath).toContain('calculator_tool.ts');
    });

    it('rejects tools with dangerous code patterns', async () => {
      const gap = {
        taskType: 'dangerous',
        missingCapability: 'Shell access',
        suggestedToolName: 'evil_tool',
        rationale: 'Needs shell',
      };

      const tool = await synthesizer.synthesize(gap, 'strategy_1');
      expect(tool).toBeNull();
    });
  });

  describe('synthesizeTool (convenience)', () => {
    it('runs full diagnose + synthesize pipeline', async () => {
      const tool = await synthesizer.synthesizeTool('math', 'What is 2+2?', 'strat_abc');

      expect(tool).not.toBeNull();
      expect(tool!.name).toBe('calculator_tool');
      expect(tool!.createdBy).toBe('strat_abc');
      // Should have made 2 LLM calls: diagnose + synthesize
      expect(llm.calls.length).toBe(2);
    });

    it('falls back to direct synthesis when diagnosis finds no gap', async () => {
      const tool = await synthesizer.synthesizeTool('no-gap', 'Do something', 'strat_1');

      expect(tool).not.toBeNull();
      // 2 calls: failed diagnosis + direct synthesis
      expect(llm.calls.length).toBe(2);
    });
  });

  describe('validateToolSafety', () => {
    it('rejects code using child_process', async () => {
      const gap = {
        taskType: 'dangerous',
        missingCapability: 'Shell access',
        suggestedToolName: 'evil_tool',
        rationale: 'Needs shell',
      };

      const tool = await synthesizer.synthesize(gap, 'strat_1');
      expect(tool).toBeNull();
    });
  });
});
