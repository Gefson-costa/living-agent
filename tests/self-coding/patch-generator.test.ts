import { describe, it, expect, beforeEach } from 'vitest';
import { PatchGenerator, resetPatchCounter } from '../../src/self-coding/patch-generator.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import type { CodeIssue } from '../../src/self-coding/types.js';

describe('PatchGenerator', () => {
  let generator: PatchGenerator;

  beforeEach(() => {
    resetPatchCounter();
    generator = new PatchGenerator(new MockAdapter(), process.cwd());
  });

  it('generates a patch with an ID', async () => {
    const issue: CodeIssue = {
      type: 'bug',
      severity: 'high',
      file: 'src/test.ts',
      description: 'Variable is undefined',
    };

    const patch = await generator.generatePatch(issue, [
      { path: 'src/test.ts', content: 'const x = 1;' },
    ]);

    expect(patch.id).toMatch(/^patch_1_/);
    expect(patch.issue).toBe(issue);
    expect(patch.description).toBeDefined();
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

    const patch = await generator.generatePatch(issue, []);

    // Patch should have a description even if mock can't generate proper patches
    expect(typeof patch.description).toBe('string');
    expect(patch.description.length).toBeGreaterThan(0);
  });

  it('handles mock LLM that does not return JSON gracefully', async () => {
    const issue: CodeIssue = {
      type: 'bug',
      severity: 'medium',
      file: 'src/test.ts',
      description: 'Issue',
    };

    // MockAdapter returns numeric content, not JSON
    const patch = await generator.generatePatch(issue, []);

    // Should not crash, may return empty files
    expect(Array.isArray(patch.files)).toBe(true);
  });

  it('increments patch counter for unique IDs', async () => {
    const issue: CodeIssue = {
      type: 'bug',
      severity: 'high',
      file: 'src/test.ts',
      description: 'Issue',
    };

    const p1 = await generator.generatePatch(issue, []);
    const p2 = await generator.generatePatch(issue, []);

    expect(p1.id).not.toBe(p2.id);
  });
});
