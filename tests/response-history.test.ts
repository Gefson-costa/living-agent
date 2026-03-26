import { describe, it, expect } from 'vitest';
import { SimpleEmbedder } from '../src/embeddings/embedder.js';
import { ResponseHistory } from '../src/embeddings/response-history.js';

function makeHistory(config = {}) {
  return new ResponseHistory(new SimpleEmbedder(), config);
}

// ── Recording ────────────────────────────────────────────────────

describe('ResponseHistory — recording', () => {
  it('records high-scoring responses', async () => {
    const h = makeHistory();
    await h.record('coding', 's1', 'function sort(arr) { return arr.sort(); }', 0.8);
    expect(h.getCount('coding')).toBe(1);
  });

  it('ignores low-scoring responses', async () => {
    const h = makeHistory();
    await h.record('coding', 's1', 'bad response', 0.3);
    expect(h.getCount('coding')).toBe(0);
  });

  it('respects custom qualityThreshold', async () => {
    const h = makeHistory({ qualityThreshold: 0.9 });
    await h.record('coding', 's1', 'decent response', 0.8);
    expect(h.getCount('coding')).toBe(0);
    await h.record('coding', 's1', 'great response', 0.95);
    expect(h.getCount('coding')).toBe(1);
  });

  it('ring buffer wraps when full', async () => {
    const h = makeHistory({ maxPerType: 3 });
    await h.record('coding', 's1', 'response alpha', 0.8);
    await h.record('coding', 's1', 'response beta', 0.8);
    await h.record('coding', 's1', 'response gamma', 0.8);
    await h.record('coding', 's1', 'response delta', 0.8);
    // Should still be 3 (ring buffer replaced oldest)
    expect(h.getCount('coding')).toBe(3);
  });

  it('tracks multiple task types independently', async () => {
    const h = makeHistory();
    await h.record('coding', 's1', 'code response', 0.8);
    await h.record('creative', 's1', 'poem response', 0.8);
    expect(h.getCount('coding')).toBe(1);
    expect(h.getCount('creative')).toBe(1);
    expect(h.taskTypes).toContain('coding');
    expect(h.taskTypes).toContain('creative');
  });
});

// ── Similarity to top responses ──────────────────────────────────

describe('ResponseHistory — similarityToTop', () => {
  it('returns null with no history', async () => {
    const h = makeHistory();
    const sim = await h.similarityToTop('coding', 'some code');
    expect(sim).toBeNull();
  });

  it('returns null with insufficient history (<3)', async () => {
    const h = makeHistory();
    await h.record('coding', 's1', 'response one', 0.8);
    await h.record('coding', 's1', 'response two', 0.8);
    const sim = await h.similarityToTop('coding', 'test');
    expect(sim).toBeNull();
  });

  it('returns score between 0 and 1 with sufficient history', async () => {
    const h = makeHistory();
    await h.record('coding', 's1', 'implement sorting algorithm quicksort python function', 0.9);
    await h.record('coding', 's1', 'debug typescript compiler error stack trace exception', 0.8);
    await h.record('coding', 's1', 'write binary search algorithm recursive implementation', 0.85);
    const sim = await h.similarityToTop('coding', 'implement mergesort algorithm');
    expect(sim).not.toBeNull();
    expect(sim!).toBeGreaterThanOrEqual(0);
    expect(sim!).toBeLessThanOrEqual(1);
  });

  it('similar responses score higher than dissimilar', async () => {
    const h = makeHistory();
    // Build coding history
    await h.record('coding', 's1', 'implement sorting algorithm quicksort python function class method', 0.9);
    await h.record('coding', 's1', 'debug typescript compiler error undefined variable stack trace', 0.8);
    await h.record('coding', 's1', 'write binary search algorithm recursive implementation javascript', 0.85);

    const codingSim = await h.similarityToTop('coding', 'implement mergesort algorithm function python');
    const unrelatedSim = await h.similarityToTop('coding', 'poem sunset ocean waves beautiful metaphor');

    expect(codingSim).not.toBeNull();
    expect(unrelatedSim).not.toBeNull();
    expect(codingSim!).toBeGreaterThan(unrelatedSim!);
  });

  it('similarityToTopFromEmbedding works with pre-computed embedding', async () => {
    const embedder = new SimpleEmbedder();
    const h = new ResponseHistory(embedder);
    await h.record('coding', 's1', 'sorting algorithm implementation', 0.9);
    await h.record('coding', 's1', 'binary search function code', 0.8);
    await h.record('coding', 's1', 'quicksort recursive algorithm', 0.85);

    const emb = await embedder.embed('implement sorting algorithm');
    const sim = h.similarityToTopFromEmbedding('coding', emb);
    expect(sim).not.toBeNull();
    expect(sim!).toBeGreaterThanOrEqual(0);
    expect(sim!).toBeLessThanOrEqual(1);
  });
});

// ── Collapse Detection ───────────────────────────────────────────

describe('ResponseHistory — collapse detection', () => {
  it('returns null with insufficient data (<5 responses)', async () => {
    const h = makeHistory();
    await h.record('coding', 's1', 'response one', 0.8);
    await h.record('coding', 's1', 'response two', 0.8);
    expect(h.detectCollapse('s1')).toBeNull();
  });

  it('returns null for unknown strategy', () => {
    const h = makeHistory();
    expect(h.detectCollapse('unknown')).toBeNull();
  });

  it('detects collapse when strategy produces identical responses', async () => {
    const h = makeHistory({ collapseThreshold: 0.1 });
    const same = 'always the exact same response output every time';
    // Record identical responses (low scores are fine, strategy log tracks all)
    for (let i = 0; i < 6; i++) {
      await h.record('coding', 's1', same, 0.3);
    }
    const result = h.detectCollapse('s1');
    expect(result).not.toBeNull();
    expect(result!.collapsed).toBe(true);
    expect(result!.variance).toBeLessThan(0.1);
  });

  it('does not flag collapse for diverse responses', async () => {
    const h = makeHistory({ collapseThreshold: 0.05 });
    const diverse = [
      'implement quicksort algorithm python sorting function recursive',
      'poem about ocean waves sunset beautiful nature landscape',
      'analyze quarterly financial data revenue profit margins growth',
      'summarize article about machine learning neural networks deep',
      'write creative story adventure hero quest journey beginning',
      'research climate change effects global warming temperature',
    ];
    for (const resp of diverse) {
      await h.record('general', 's2', resp, 0.3); // low score ok for strategy log
    }
    const result = h.detectCollapse('s2');
    expect(result).not.toBeNull();
    expect(result!.collapsed).toBe(false);
    expect(result!.variance).toBeGreaterThan(0.05);
  });
});

// ── Diversity Measurement ────────────────────────────────────────

describe('ResponseHistory — diversity', () => {
  it('returns null with insufficient data', async () => {
    const h = makeHistory();
    await h.record('coding', 's1', 'response', 0.3);
    expect(h.outputDiversity('s1', 's2')).toBeNull();
  });

  it('measures low diversity between similar strategies', async () => {
    const h = makeHistory();
    const codingResponses = [
      'implement sorting algorithm quicksort python function',
      'write binary search algorithm recursive implementation',
      'debug compiler error stack trace exception handling',
    ];
    for (const r of codingResponses) {
      await h.record('coding', 's1', r, 0.3);
      // Slightly different but same domain
      await h.record('coding', 's2', r + ' method class', 0.3);
    }
    const div = h.outputDiversity('s1', 's2');
    expect(div).not.toBeNull();
    expect(div!).toBeLessThan(0.4); // similar domains → low diversity
  });

  it('measures high diversity between different strategies', async () => {
    const h = makeHistory();
    const coding = [
      'implement sorting algorithm quicksort python function recursive',
      'debug typescript compiler error stack trace exception undefined',
      'write binary search algorithm implementation javascript code',
    ];
    const creative = [
      'poem about ocean waves sunset beautiful nature landscape birds',
      'story adventure hero quest journey beginning chapter narrative',
      'song lyrics melody chorus verse rhyme rhythm harmony bridge',
    ];
    for (const r of coding) await h.record('coding', 'coder', r, 0.3);
    for (const r of creative) await h.record('creative', 'poet', r, 0.3);

    const div = h.outputDiversity('coder', 'poet');
    expect(div).not.toBeNull();
    expect(div!).toBeGreaterThan(0.1); // different domains → higher diversity
  });
});

// ── Accessors ────────────────────────────────────────────────────

describe('ResponseHistory — accessors', () => {
  it('hasHistory checks minimum 3 entries', async () => {
    const h = makeHistory();
    expect(h.hasHistory('coding')).toBe(false);
    await h.record('coding', 's1', 'r1', 0.8);
    await h.record('coding', 's1', 'r2', 0.8);
    expect(h.hasHistory('coding')).toBe(false);
    await h.record('coding', 's1', 'r3', 0.8);
    expect(h.hasHistory('coding')).toBe(true);
  });

  it('trackedStrategies counts unique strategies', async () => {
    const h = makeHistory();
    expect(h.trackedStrategies).toBe(0);
    await h.record('coding', 's1', 'r1', 0.3);
    await h.record('coding', 's2', 'r2', 0.3);
    expect(h.trackedStrategies).toBe(2);
  });

  it('getEmbedder returns the embedder', () => {
    const embedder = new SimpleEmbedder();
    const h = new ResponseHistory(embedder);
    expect(h.getEmbedder()).toBe(embedder);
  });
});

// ── Integration with local-eval ──────────────────────────────────

describe('ResponseHistory — local-eval integration', () => {
  it('provides 4th signal to computeLocalEval', async () => {
    const { computeLocalEval } = await import('../src/fitness/local-eval.js');
    const embedder = new SimpleEmbedder();
    const h = new ResponseHistory(embedder);

    // Build history
    await h.record('coding', 's1', 'function quicksort(arr) { if (arr.length <= 1) return arr; }', 0.9);
    await h.record('coding', 's1', 'function binarySearch(arr, target) { let lo = 0; }', 0.85);
    await h.record('coding', 's1', 'class Stack { push(val) { this.items.push(val); } }', 0.8);

    const task = { id: 't1', type: 'coding', prompt: 'implement a queue', difficulty: 0.5 };
    const response = 'class Queue { enqueue(val) { this.items.push(val); } dequeue() { return this.items.shift(); } }';
    const responseEmbedding = await embedder.embed(response);

    // With response history
    const withHistory = computeLocalEval(response, task, { responseHistory: h, responseEmbedding });
    // Without response history
    const withoutHistory = computeLocalEval(response, task);

    expect(withHistory.responseSimilarity).not.toBeNull();
    expect(withoutHistory.responseSimilarity).toBeNull();
    // Both should produce valid scores
    expect(withHistory.score).toBeGreaterThan(0);
    expect(withHistory.score).toBeLessThanOrEqual(1);
  });
});
