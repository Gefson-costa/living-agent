import { describe, it, expect } from 'vitest';
import { Validator } from '../../src/self-coding/validator.js';

describe('Validator', () => {
  it('parses text test output with pass count', async () => {
    // Use a command that prints something resembling test output
    const validator = new Validator(
      process.cwd(),
      'echo "Tests  42 passed (42) Duration 1.5s"',
      'echo "ok"',
    );

    const results = await validator.runTests();
    expect(results.passed).toBe(42);
    expect(results.failed).toBe(0);
    expect(results.total).toBe(42);
  });

  it('parses text output with both passed and failed', async () => {
    const validator = new Validator(
      process.cwd(),
      'echo "Tests  38 passed 4 failed Duration 2.0s"',
      'echo "ok"',
    );

    const results = await validator.runTests();
    expect(results.passed).toBe(38);
    expect(results.failed).toBe(4);
    expect(results.total).toBe(42);
  });

  it('runBuild returns true on success', async () => {
    const validator = new Validator(process.cwd(), 'echo ok', 'echo ok');
    expect(await validator.runBuild()).toBe(true);
  });

  it('runBuild returns false on failure', async () => {
    const validator = new Validator(process.cwd(), 'echo ok', 'exit 1');
    expect(await validator.runBuild()).toBe(false);
  });

  it('validate compares with baseline', async () => {
    const validator = new Validator(
      process.cwd(),
      'echo "Tests  10 passed Duration 0.5s"',
      'echo "ok"',
    );

    const baseline = { total: 10, passed: 10, failed: 0, duration: 500 };
    const result = await validator.validate(baseline);

    expect(result.buildPass).toBe(true);
    expect(result.testsPass).toBe(true);
    expect(result.testResults.passed).toBe(10);
  });

  it('validate fails when passed count decreases', async () => {
    const validator = new Validator(
      process.cwd(),
      'echo "Tests  8 passed Duration 0.5s"',
      'echo "ok"',
    );

    const baseline = { total: 10, passed: 10, failed: 0, duration: 500 };
    const result = await validator.validate(baseline);

    expect(result.testsPass).toBe(false);
  });

  it('handles command timeout gracefully', async () => {
    const validator = new Validator(process.cwd(), 'echo "no test output"', 'echo "ok"');
    const results = await validator.runTests();
    expect(results.total).toBe(0);
  });
});
