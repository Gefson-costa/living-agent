import { describe, it, expect, vi } from 'vitest';
import { CodebaseAnalyzer } from '../../src/self-coding/analyzer.js';
import { Validator } from '../../src/self-coding/validator.js';
import { MockAdapter } from '../../src/llm/adapter.js';
import type { SelfCodingConfig } from '../../src/self-coding/types.js';

describe('CodebaseAnalyzer', () => {
  function makeConfig(overrides: Partial<SelfCodingConfig> = {}): SelfCodingConfig {
    return {
      projectRoot: process.cwd(),
      testCommand: 'echo "Tests  10 passed Duration 0.5s"',
      buildCommand: 'echo "ok"',
      maxIterations: 1,
      branchPrefix: 'test',
      requireHumanReview: true,
      focusAreas: [],
      excludePatterns: ['src/self-coding/**'],
      llm: new MockAdapter(),
      ...overrides,
    };
  }

  it('returns test failure issue when tests fail', async () => {
    const config = makeConfig({
      testCommand: 'echo "Tests  8 passed 2 failed Duration 0.5s"',
    });
    const validator = new Validator(config.projectRoot, config.testCommand, config.buildCommand);
    const analyzer = new CodebaseAnalyzer(config, validator);

    const issues = await analyzer.analyze();

    const testFailure = issues.find(i => i.type === 'test-failure');
    expect(testFailure).toBeDefined();
    expect(testFailure!.severity).toBe('high');
  });

  it('returns no test failure issue when all tests pass', async () => {
    const config = makeConfig();
    const validator = new Validator(config.projectRoot, config.testCommand, config.buildCommand);
    const analyzer = new CodebaseAnalyzer(config, validator);

    const issues = await analyzer.analyze();

    const testFailure = issues.find(i => i.type === 'test-failure');
    expect(testFailure).toBeUndefined();
  });

  it('sorts issues by severity (high first)', async () => {
    const config = makeConfig({
      testCommand: 'echo "Tests  8 passed 2 failed Duration 0.5s"',
    });
    const validator = new Validator(config.projectRoot, config.testCommand, config.buildCommand);
    const analyzer = new CodebaseAnalyzer(config, validator);

    const issues = await analyzer.analyze();

    if (issues.length > 1) {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      for (let i = 0; i < issues.length - 1; i++) {
        expect(severityOrder[issues[i].severity]).toBeLessThanOrEqual(
          severityOrder[issues[i + 1].severity],
        );
      }
    }
  });

  it('handles empty focus areas without crashing', async () => {
    const config = makeConfig({ focusAreas: [] });
    const validator = new Validator(config.projectRoot, config.testCommand, config.buildCommand);
    const analyzer = new CodebaseAnalyzer(config, validator);

    const issues = await analyzer.analyze();
    expect(Array.isArray(issues)).toBe(true);
  });
});
