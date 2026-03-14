import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitSandbox } from '../../src/self-coding/sandbox.js';
import { execFile } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);

describe('GitSandbox', () => {
  let tempDir: string;
  let sandbox: GitSandbox;

  beforeEach(async () => {
    // Create a temporary git repo
    tempDir = join(tmpdir(), `sandbox-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await exec('git', ['init'], { cwd: tempDir });
    await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: tempDir });

    // Create initial commit
    await writeFile(join(tempDir, 'hello.txt'), 'hello world');
    await exec('git', ['add', '.'], { cwd: tempDir });
    await exec('git', ['commit', '-m', 'initial'], { cwd: tempDir });

    // Rename branch to main
    await exec('git', ['branch', '-M', 'main'], { cwd: tempDir });

    sandbox = new GitSandbox(tempDir, 'self-coding');
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup failure is ok in tests
    }
  });

  it('gets current branch', async () => {
    const branch = await sandbox.getCurrentBranch();
    expect(branch).toBe('main');
  });

  it('verifies main branch', async () => {
    expect(await sandbox.verifyMainBranch()).toBe(true);
  });

  it('creates and switches to a new branch', async () => {
    const branchName = await sandbox.createBranch('test-patch');
    expect(branchName).toBe('self-coding/test-patch');

    const current = await sandbox.getCurrentBranch();
    expect(current).toBe('self-coding/test-patch');
  });

  it('applies a patch and commits', async () => {
    await sandbox.createBranch('apply-test');

    await sandbox.applyPatch({
      id: 'p1',
      issue: { type: 'bug', severity: 'high', file: 'hello.txt', description: 'test' },
      files: [{
        path: 'hello.txt',
        original: 'hello world',
        modified: 'hello patched world',
      }],
      description: 'test patch',
    });

    // Verify the file was modified
    const { stdout } = await exec('git', ['log', '--oneline', '-1'], { cwd: tempDir });
    expect(stdout).toContain('self-coding: test patch');
  });

  it('merges branch back to main', async () => {
    const branch = await sandbox.createBranch('merge-test');

    await sandbox.applyPatch({
      id: 'p2',
      issue: { type: 'bug', severity: 'high', file: 'hello.txt', description: 'test' },
      files: [{
        path: 'hello.txt',
        original: 'hello world',
        modified: 'hello merged world',
      }],
      description: 'merge test',
    });

    await sandbox.merge(branch);

    const current = await sandbox.getCurrentBranch();
    expect(current).toBe('main');
  });

  it('rolls back a branch', async () => {
    const branch = await sandbox.createBranch('rollback-test');

    await sandbox.applyPatch({
      id: 'p3',
      issue: { type: 'bug', severity: 'high', file: 'hello.txt', description: 'test' },
      files: [{
        path: 'hello.txt',
        original: 'hello world',
        modified: 'hello rolled-back world',
      }],
      description: 'rollback test',
    });

    await sandbox.rollback(branch);

    const current = await sandbox.getCurrentBranch();
    expect(current).toBe('main');
  });

  it('detects uncommitted changes', async () => {
    expect(await sandbox.hasUncommittedChanges()).toBe(false);

    await writeFile(join(tempDir, 'new-file.txt'), 'uncommitted');
    expect(await sandbox.hasUncommittedChanges()).toBe(true);
  });

  it('rejects patch when file content does not match', async () => {
    await sandbox.createBranch('mismatch-test');

    await expect(
      sandbox.applyPatch({
        id: 'p4',
        issue: { type: 'bug', severity: 'high', file: 'hello.txt', description: 'test' },
        files: [{
          path: 'hello.txt',
          original: 'wrong original content',
          modified: 'new content',
        }],
        description: 'mismatch test',
      }),
    ).rejects.toThrow('has been modified');
  });
});
