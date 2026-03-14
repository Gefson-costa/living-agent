// ================================================================
//  Git Sandbox — Isolated branch operations for self-coding
//
//  Creates branches, applies patches, merges or rolls back.
//  All modifications happen on isolated branches, never on main.
// ================================================================

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { CodePatch } from './types.js';

const exec = promisify(execFile);

export class GitSandbox {
  private projectRoot: string;
  private branchPrefix: string;
  private originalBranch: string | null = null;

  constructor(projectRoot: string, branchPrefix = 'self-coding') {
    this.projectRoot = projectRoot;
    this.branchPrefix = branchPrefix;
  }

  /** Get the current git branch */
  async getCurrentBranch(): Promise<string> {
    const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: this.projectRoot,
    });
    return stdout.trim();
  }

  /** Verify we're on main/master branch */
  async verifyMainBranch(): Promise<boolean> {
    const branch = await this.getCurrentBranch();
    return branch === 'main' || branch === 'master';
  }

  /** Create and switch to a new branch for a patch */
  async createBranch(patchId: string): Promise<string> {
    this.originalBranch = await this.getCurrentBranch();
    const branchName = `${this.branchPrefix}/${patchId}`;

    await exec('git', ['checkout', '-b', branchName], {
      cwd: this.projectRoot,
    });

    return branchName;
  }

  /** Apply a patch by writing modified files */
  async applyPatch(patch: CodePatch): Promise<void> {
    for (const file of patch.files) {
      const fullPath = `${this.projectRoot}/${file.path}`;

      // Verify the file currently contains the expected original content
      const current = await readFile(fullPath, 'utf-8');
      if (current !== file.original) {
        throw new Error(
          `File ${file.path} has been modified since analysis. ` +
          `Expected ${file.original.length} chars, got ${current.length} chars.`,
        );
      }

      await writeFile(fullPath, file.modified, 'utf-8');
    }

    // Stage all changes
    const paths = patch.files.map(f => f.path);
    await exec('git', ['add', ...paths], { cwd: this.projectRoot });

    // Commit
    await exec('git', ['commit', '-m', `self-coding: ${patch.description}`], {
      cwd: this.projectRoot,
    });
  }

  /** Merge a branch into the original branch */
  async merge(branchName: string): Promise<void> {
    if (!this.originalBranch) {
      throw new Error('No original branch recorded — cannot merge');
    }

    await exec('git', ['checkout', this.originalBranch], { cwd: this.projectRoot });
    await exec('git', ['merge', branchName, '--no-ff', '-m', `merge: ${branchName}`], {
      cwd: this.projectRoot,
    });
    await exec('git', ['branch', '-d', branchName], { cwd: this.projectRoot });
    this.originalBranch = null;
  }

  /** Rollback — discard the branch and return to original */
  async rollback(branchName: string): Promise<void> {
    if (!this.originalBranch) {
      throw new Error('No original branch recorded — cannot rollback');
    }

    await exec('git', ['checkout', this.originalBranch], { cwd: this.projectRoot });
    await exec('git', ['branch', '-D', branchName], { cwd: this.projectRoot });
    this.originalBranch = null;
  }

  /** Check if there are uncommitted changes */
  async hasUncommittedChanges(): Promise<boolean> {
    const { stdout } = await exec('git', ['status', '--porcelain'], {
      cwd: this.projectRoot,
    });
    return stdout.trim().length > 0;
  }
}
