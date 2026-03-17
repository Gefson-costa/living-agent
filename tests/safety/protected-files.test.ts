import { describe, it, expect } from 'vitest';
import {
  PROTECTED_PATHS,
  isProtectedPath,
  validatePatchPaths,
} from '../../src/safety/protected-files.js';

describe('Protected Files', () => {
  // ── PROTECTED_PATHS constant ──────────────────────────

  it('has expected paths', () => {
    expect(PROTECTED_PATHS).toContain('src/safety/');
    expect(PROTECTED_PATHS).toContain('src/fitness/hybrid-fitness.ts');
    expect(PROTECTED_PATHS).toContain('src/evolution/ecology.ts');
    expect(PROTECTED_PATHS).toContain('src/evolution/evolution-engine.ts');
    expect(PROTECTED_PATHS).toContain('src/evolution/elo-tracker.ts');
  });

  // ── isProtectedPath ───────────────────────────────────

  it('detects safety directory files', () => {
    expect(isProtectedPath('src/safety/budget-cap.ts')).toBe(true);
    expect(isProtectedPath('src/safety/audit-log.ts')).toBe(true);
    expect(isProtectedPath('src/safety/anything.ts')).toBe(true);
  });

  it('detects safety directory itself', () => {
    expect(isProtectedPath('src/safety/')).toBe(true);
  });

  it('detects exact file matches', () => {
    expect(isProtectedPath('src/fitness/hybrid-fitness.ts')).toBe(true);
    expect(isProtectedPath('src/evolution/ecology.ts')).toBe(true);
    expect(isProtectedPath('src/evolution/evolution-engine.ts')).toBe(true);
    expect(isProtectedPath('src/evolution/elo-tracker.ts')).toBe(true);
  });

  it('allows non-protected files', () => {
    expect(isProtectedPath('src/agent/living-agent.ts')).toBe(false);
    expect(isProtectedPath('src/evolution/genome.ts')).toBe(false);
    expect(isProtectedPath('src/llm/adapter.ts')).toBe(false);
    expect(isProtectedPath('src/fitness/self-eval.ts')).toBe(false);
  });

  it('normalizes backslashes', () => {
    expect(isProtectedPath('src\\safety\\budget-cap.ts')).toBe(true);
    expect(isProtectedPath('src\\evolution\\ecology.ts')).toBe(true);
  });

  it('respects extra paths', () => {
    expect(isProtectedPath('src/custom/important.ts')).toBe(false);
    expect(isProtectedPath('src/custom/important.ts', ['src/custom/'])).toBe(true);
  });

  it('extra paths with exact file', () => {
    expect(isProtectedPath('config.json', ['config.json'])).toBe(true);
    expect(isProtectedPath('other.json', ['config.json'])).toBe(false);
  });

  // ── validatePatchPaths ────────────────────────────────

  it('validates clean patch (no violations)', () => {
    const result = validatePatchPaths([
      { path: 'src/agent/living-agent.ts' },
      { path: 'src/llm/adapter.ts' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('detects single violation', () => {
    const result = validatePatchPaths([
      { path: 'src/agent/living-agent.ts' },
      { path: 'src/safety/budget-cap.ts' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['src/safety/budget-cap.ts']);
  });

  it('detects multiple violations', () => {
    const result = validatePatchPaths([
      { path: 'src/safety/audit-log.ts' },
      { path: 'src/evolution/ecology.ts' },
      { path: 'src/agent/living-agent.ts' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain('src/safety/audit-log.ts');
    expect(result.violations).toContain('src/evolution/ecology.ts');
  });

  it('validates with extra paths', () => {
    const result = validatePatchPaths(
      [{ path: 'data/audit.jsonl' }],
      ['data/audit.jsonl'],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('data/audit.jsonl');
  });

  it('handles empty patch list', () => {
    const result = validatePatchPaths([]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
