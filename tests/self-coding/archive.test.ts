import { describe, it, expect, beforeEach } from 'vitest';
import { SelfCodingArchive } from '../../src/self-coding/archive.js';
import { MemoryStore } from '../../src/storage/memory-store.js';
import type { CodingAttempt } from '../../src/self-coding/types.js';

function makeAttempt(success: boolean, id = 'test'): CodingAttempt {
  return {
    id,
    issue: {
      type: 'bug',
      severity: 'medium',
      file: 'src/test.ts',
      description: 'Test issue',
    },
    patch: null,
    result: {
      patchId: id,
      success,
      testsPass: success,
      buildPass: success,
      fitnessGain: success ? 0.1 : 0,
      branchName: '',
      merged: success,
    },
    timestamp: Date.now(),
  };
}

describe('SelfCodingArchive', () => {
  let store: MemoryStore;
  let archive: SelfCodingArchive;

  beforeEach(() => {
    store = new MemoryStore();
    archive = new SelfCodingArchive(store);
  });

  it('starts empty', () => {
    expect(archive.size).toBe(0);
    expect(archive.getHistory()).toEqual([]);
    expect(archive.getSuccessRate()).toBe(0);
  });

  it('records attempts', async () => {
    await archive.record(makeAttempt(true, 'a1'));
    await archive.record(makeAttempt(false, 'a2'));
    expect(archive.size).toBe(2);
  });

  it('computes success rate', async () => {
    await archive.record(makeAttempt(true));
    await archive.record(makeAttempt(true));
    await archive.record(makeAttempt(false));
    expect(archive.getSuccessRate()).toBeCloseTo(2 / 3);
  });

  it('counts consecutive failures', async () => {
    await archive.record(makeAttempt(true));
    await archive.record(makeAttempt(false));
    await archive.record(makeAttempt(false));
    expect(archive.getConsecutiveFailures()).toBe(2);
  });

  it('resets consecutive failures after success', async () => {
    await archive.record(makeAttempt(false));
    await archive.record(makeAttempt(false));
    await archive.record(makeAttempt(true));
    expect(archive.getConsecutiveFailures()).toBe(0);
  });

  it('persists and restores from storage', async () => {
    await archive.record(makeAttempt(true, 'p1'));
    await archive.record(makeAttempt(false, 'p2'));

    const archive2 = new SelfCodingArchive(store);
    await archive2.load();
    expect(archive2.size).toBe(2);
    expect(archive2.getSuccessRate()).toBeCloseTo(0.5);
  });

  it('limits history to 100 entries', async () => {
    for (let i = 0; i < 110; i++) {
      await archive.record(makeAttempt(true, `a${i}`));
    }
    expect(archive.size).toBe(100);
  });
});
