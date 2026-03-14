// ================================================================
//  Validator — Run tests and build to validate patches
//
//  Parses Vitest JSON output and compares with baseline.
//  Acceptance: build passes AND tests pass AND passed >= baseline.
// ================================================================

import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { TestResults, ValidationResult } from './types.js';

const exec = promisify(execCb);

export class Validator {
  private projectRoot: string;
  private testCommand: string;
  private buildCommand: string;

  constructor(projectRoot: string, testCommand: string, buildCommand: string) {
    this.projectRoot = projectRoot;
    this.testCommand = testCommand;
    this.buildCommand = buildCommand;
  }

  /** Run the test suite and parse results */
  async runTests(): Promise<TestResults> {
    try {
      const { stdout, stderr } = await exec(this.testCommand, {
        cwd: this.projectRoot,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return this.parseTestOutput(stdout, stderr);
    } catch (err: any) {
      // Vitest exits with non-zero when tests fail — still parse output
      if (err.stdout || err.stderr) {
        return this.parseTestOutput(err.stdout ?? '', err.stderr ?? '');
      }
      return { total: 0, passed: 0, failed: 0, duration: 0 };
    }
  }

  /** Run the build command */
  async runBuild(): Promise<boolean> {
    try {
      await exec(this.buildCommand, {
        cwd: this.projectRoot,
        timeout: 60_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Full validation: build + test + compare with baseline */
  async validate(baseline: TestResults): Promise<ValidationResult> {
    const buildPass = await this.runBuild();
    const testResults = await this.runTests();
    const testsPass = testResults.failed === 0 && testResults.passed >= baseline.passed;

    return {
      testsPass,
      buildPass,
      testResults,
      baseline,
    };
  }

  private parseTestOutput(stdout: string, stderr: string): TestResults {
    const combined = stdout + stderr;

    // Try to parse Vitest JSON reporter output
    try {
      const jsonMatch = combined.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const results = data.testResults ?? [];
        let total = 0;
        let passed = 0;
        let failed = 0;

        for (const suite of results) {
          for (const test of suite.assertionResults ?? []) {
            total++;
            if (test.status === 'passed') passed++;
            else failed++;
          }
        }

        return {
          total,
          passed,
          failed,
          duration: data.startTime ? Date.now() - data.startTime : 0,
        };
      }
    } catch {
      // JSON parse failed — fall through to text parsing
    }

    // Fallback: parse text output (e.g., "Tests  316 passed (316)")
    const passMatch = combined.match(/(\d+)\s+passed/);
    const failMatch = combined.match(/(\d+)\s+failed/);
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;

    const durationMatch = combined.match(/Duration\s+([\d.]+)s/);
    const duration = durationMatch ? parseFloat(durationMatch[1]) * 1000 : 0;

    return { total: passed + failed, passed, failed, duration };
  }
}
