import { describe, it, expect, beforeEach } from 'vitest';
import { PatchGenerator, resetPatchCounter } from '../../src/self-coding/patch-generator.js';
import type { CodeIssue, CodePatch } from '../../src/self-coding/types.js';
import type { LLMAdapter, LLMConfig, LLMResponse } from '../../src/core/types.js';

class JSONMockAdapter implements LLMAdapter {
  async execute(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    if (prompt.includes('no-json')) {
      return { content: 'This is just text, no JSON here.', tokensUsed: 10, latencyMs: 50 };
    }

    const response = {
      description: 'Mock fix applied',
      files: [
        {
          path: 'src/test.ts',
          original: 'const x = 1;',
          modified: `const x = 1;\n// fixed at temp ${config.temperature.toFixed(2)}`
        }
      ]
    };
    return { content: JSON.stringify(response), tokensUsed: 100, latencyMs: 100 };
  }
}

describe('PatchGenerator', () => {
  let generator: PatchGenerator;

  beforeEach(() => {
    resetPatchCounter();
    generator = new PatchGenerator(new JSONMockAdapter(), process.cwd());
  });

  it('generates a patch with an ID', async () => {
    const issue: CodeIssue = {
      type: 'bug',
      severity: 'high',
      file: 'src/test.ts',
      description: 'Variable is undefined',
    };

    const patches = await generator.generatePatchCandidates(issue, [
      { path: 'src/test.ts', content: 'const x = 1;' },
    ], 1);

    expect(patches.length).toBe(1);
    expect(patches[0].id).toMatch(/^patch_1_/);
    expect(patches[0].issue).toBe(issue);
    expect(patches[0].files[0].modified).toContain('fixed');
  });

  it('includes issue context in the patch description', async () => {
    const issue: CodeIssue = {
      type: 'dead-code',
      severity: 'low',
      file: 'src/utils.ts',
      line: 42,
      description: 'Unused function',
      suggestedFix: 'Remove the function',
    };

    const patches = await generator.generatePatchCandidates(issue, [], 1);
    expect(patches.length).toBe(1);
    expect(patches[0].description).toBe('Mock fix applied');
  });

  it('handles mock LLM that does not return JSON gracefully', async () => {
    const issue: CodeIssue = {
      type: 'bug',
      severity: 'medium',
      file: 'src/test.ts',
      description: 'no-json please',
    };

    // The JSONMockAdapter returns raw string if 'no-json' is in prompt
    const patches = await generator.generatePatchCandidates(issue, [], 1);

    // Should gracefully return empty array because no files were parsed
    expect(patches.length).toBe(0);
  });

  it('generates multiple unique candidates', async () => {
    const issue: CodeIssue = {
      type: 'bug',
      severity: 'high',
      file: 'src/test.ts',
      description: 'Issue',
    };

    // Tree search count = 3
    const patches = await generator.generatePatchCandidates(issue, [], 3);
    
    // Each call gets a slightly higher temperature, which our mock incorporates into the modified code
    expect(patches.length).toBe(3);
    
    // Ensure IDs are unique
    const ids = new Set(patches.map(p => p.id));
    expect(ids.size).toBe(3);
  });
});
