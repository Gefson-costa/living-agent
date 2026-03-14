// ================================================================
//  Self-Coding Loop — Main orchestrator
//
//  Analyzes codebase → identifies issues → generates patches →
//  validates on isolated branches → merges if safe.
//
//  Safety: all modifications on branches, self-coding code excluded,
//  full test suite must pass, human review by default.
// ================================================================

import { readFile } from 'node:fs/promises';
import type { StorageAdapter } from '../core/types.js';
import type {
  SelfCodingConfig, CodeIssue, PatchResult, CodingAttempt,
} from './types.js';
import { DEFAULT_SELF_CODING_CONFIG } from './types.js';
import { CodebaseAnalyzer } from './analyzer.js';
import { PatchGenerator } from './patch-generator.js';
import { GitSandbox } from './sandbox.js';
import { Validator } from './validator.js';
import { SelfCodingArchive } from './archive.js';

export class SelfCodingLoop {
  private config: SelfCodingConfig;
  private analyzer: CodebaseAnalyzer;
  private patchGen: PatchGenerator;
  private sandbox: GitSandbox;
  private validator: Validator;
  private archive: SelfCodingArchive;

  constructor(config: Partial<SelfCodingConfig> & { projectRoot: string; llm: SelfCodingConfig['llm'] }, store: StorageAdapter) {
    this.config = { ...DEFAULT_SELF_CODING_CONFIG, ...config } as SelfCodingConfig;
    this.validator = new Validator(
      this.config.projectRoot,
      this.config.testCommand,
      this.config.buildCommand,
    );
    this.analyzer = new CodebaseAnalyzer(this.config, this.validator);
    this.patchGen = new PatchGenerator(this.config.llm, this.config.projectRoot, this.config.genome);
    this.sandbox = new GitSandbox(this.config.projectRoot, this.config.branchPrefix);
    this.archive = new SelfCodingArchive(store);
  }

  /** Initialize — load archive history */
  async init(): Promise<void> {
    await this.archive.load();
  }

  /** Run a single improvement cycle */
  async runOnce(): Promise<PatchResult> {
    // 1. Verify we're on main/master
    const onMain = await this.sandbox.verifyMainBranch();
    if (!onMain) {
      throw new Error('Self-coding loop must start from main/master branch');
    }

    // 2. Check for uncommitted changes
    if (await this.sandbox.hasUncommittedChanges()) {
      throw new Error('Cannot run self-coding with uncommitted changes');
    }

    // 3. Analyze codebase for issues
    const issues = await this.analyzer.analyze();
    if (issues.length === 0) {
      return {
        patchId: 'none',
        success: false,
        testsPass: true,
        buildPass: true,
        fitnessGain: 0,
        branchName: '',
        merged: false,
      };
    }

    // 4. Pick highest priority issue
    const issue = issues[0];

    // 5. Read relevant files for context
    const contextFiles = await this.readContextFiles(issue);

    // 6. Generate patch
    const patch = await this.patchGen.generatePatch(issue, contextFiles);

    if (patch.files.length === 0) {
      const attempt: CodingAttempt = {
        id: patch.id,
        issue,
        patch,
        result: null,
        timestamp: Date.now(),
      };
      await this.archive.record(attempt);
      return {
        patchId: patch.id,
        success: false,
        testsPass: false,
        buildPass: false,
        fitnessGain: 0,
        branchName: '',
        merged: false,
      };
    }

    // 7. Get baseline test results
    const baseline = await this.validator.runTests();

    // 8. Create branch and apply patch
    const branchName = await this.sandbox.createBranch(patch.id);

    let result: PatchResult;
    try {
      await this.sandbox.applyPatch(patch);

      // 9. Validate
      const validation = await this.validator.validate(baseline);

      const success = validation.buildPass && validation.testsPass;
      const fitnessGain = success
        ? (validation.testResults.passed - baseline.passed) / Math.max(1, baseline.total)
        : 0;

      // 10. Merge or leave for review
      let merged = false;
      if (success && !this.config.requireHumanReview) {
        await this.sandbox.merge(branchName);
        merged = true;
      } else if (!success) {
        await this.sandbox.rollback(branchName);
      }
      // If requireHumanReview && success: leave branch for review

      result = {
        patchId: patch.id,
        success,
        testsPass: validation.testsPass,
        buildPass: validation.buildPass,
        fitnessGain,
        branchName: merged ? '' : branchName,
        merged,
      };
    } catch (err) {
      // Rollback on any exception
      try {
        await this.sandbox.rollback(branchName);
      } catch {
        // Best effort rollback
      }

      result = {
        patchId: patch.id,
        success: false,
        testsPass: false,
        buildPass: false,
        fitnessGain: 0,
        branchName: '',
        merged: false,
      };
    }

    // 11. Record attempt
    const attempt: CodingAttempt = {
      id: patch.id,
      issue,
      patch,
      result,
      timestamp: Date.now(),
    };
    await this.archive.record(attempt);

    // 12. Report result to evolution system (if connected)
    this.config.onPatchResult?.(result);

    return result;
  }

  /** Run multiple improvement cycles */
  async run(maxIterations?: number): Promise<PatchResult[]> {
    const limit = maxIterations ?? this.config.maxIterations;
    const results: PatchResult[] = [];

    for (let i = 0; i < limit; i++) {
      // Anti-loop: stop after 3 consecutive failures
      if (this.archive.getConsecutiveFailures() >= 3) {
        break;
      }

      const result = await this.runOnce();
      results.push(result);

      // Stop if no issues found
      if (result.patchId === 'none') break;
    }

    return results;
  }

  /** Get archive statistics */
  getStats(): { attempts: number; successRate: number; consecutiveFailures: number } {
    return {
      attempts: this.archive.size,
      successRate: this.archive.getSuccessRate(),
      consecutiveFailures: this.archive.getConsecutiveFailures(),
    };
  }

  private async readContextFiles(
    issue: CodeIssue,
  ): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];

    // Always include the issue's file
    if (issue.file && !issue.file.endsWith('/')) {
      try {
        const content = await readFile(`${this.config.projectRoot}/${issue.file}`, 'utf-8');
        files.push({ path: issue.file, content });
      } catch {
        // File not found
      }
    }

    return files;
  }
}
