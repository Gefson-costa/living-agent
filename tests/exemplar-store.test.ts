import { describe, it, expect } from 'vitest';
import { ExemplarStore } from '../src/learning/exemplar-store.js';

describe('ExemplarStore', () => {
  it('records and retrieves exemplars', () => {
    const store = new ExemplarStore();
    store.record('math', 'What is 2+2?', '4', 0.9);
    store.record('math', 'What is 3+3?', '6', 0.8);

    const results = store.retrieve('math', 3, 1000);
    expect(results).toHaveLength(2);
    expect(results[0].score).toBe(0.9); // sorted by score descending
    expect(results[1].score).toBe(0.8);
  });

  it('ignores low-scoring exemplars (< 0.5)', () => {
    const store = new ExemplarStore();
    store.record('math', 'Bad task', 'wrong', 0.3);
    expect(store.count('math')).toBe(0);
  });

  it('respects maxPerType limit', () => {
    const store = new ExemplarStore(3);
    for (let i = 0; i < 5; i++) {
      store.record('math', `Task ${i}`, `Answer ${i}`, 0.5 + i * 0.1);
    }
    expect(store.count('math')).toBe(3);
    // Should keep top 3 by score
    const results = store.retrieve('math', 5, 10000);
    expect(results).toHaveLength(3);
    expect(results[0].score).toBe(0.9);
  });

  it('respects token budget during retrieval', () => {
    const store = new ExemplarStore();
    store.record('math', 'Short', 'Yes', 0.9); // ~3 tokens
    store.record('math', 'A'.repeat(400), 'B'.repeat(400), 0.8); // ~200 tokens

    // Small budget should only get the short one
    const results = store.retrieve('math', 5, 10);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.9);
  });

  it('respects count limit', () => {
    const store = new ExemplarStore();
    store.record('math', 'Q1', 'A1', 0.9);
    store.record('math', 'Q2', 'A2', 0.8);
    store.record('math', 'Q3', 'A3', 0.7);

    const results = store.retrieve('math', 2, 10000);
    expect(results).toHaveLength(2);
  });

  it('returns empty for unknown task type', () => {
    const store = new ExemplarStore();
    expect(store.retrieve('unknown', 3, 1000)).toEqual([]);
    expect(store.has('unknown')).toBe(false);
  });

  it('tracks size across task types', () => {
    const store = new ExemplarStore();
    store.record('math', 'Q1', 'A1', 0.9);
    store.record('coding', 'Q2', 'A2', 0.8);
    expect(store.size).toBe(2);
    expect(store.taskTypes).toContain('math');
    expect(store.taskTypes).toContain('coding');
  });

  it('serializes and deserializes', () => {
    const store = new ExemplarStore();
    store.record('math', 'Q1', 'A1', 0.9);
    store.record('coding', 'Q2', 'A2', 0.8);

    const json = store.serialize();
    const restored = ExemplarStore.deserialize(json);

    expect(restored.size).toBe(2);
    expect(restored.retrieve('math', 1, 1000)[0].score).toBe(0.9);
    expect(restored.retrieve('coding', 1, 1000)[0].score).toBe(0.8);
  });

  it('handles corrupted JSON gracefully', () => {
    const restored = ExemplarStore.deserialize('not valid json');
    expect(restored.size).toBe(0);
  });
});
