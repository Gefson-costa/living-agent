import { describe, it, expect } from 'vitest';
import {
  SimpleEmbedder,
  cosineSimilarity,
  centroid,
  updateCentroid,
} from '../src/embeddings/embedder.js';
import { EmbeddingRouter } from '../src/embeddings/embedding-router.js';
import type { Strategy } from '../src/core/types.js';

// ── Vector Utils ──────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('handles zero vectors', () => {
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([1, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('centroid', () => {
  it('returns mean of embeddings', () => {
    const a = new Float32Array([2, 0]);
    const b = new Float32Array([0, 4]);
    const c = centroid([a, b]);
    expect(c[0]).toBeCloseTo(1, 5);
    expect(c[1]).toBeCloseTo(2, 5);
  });

  it('returns empty array for no inputs', () => {
    expect(centroid([]).length).toBe(0);
  });
});

describe('updateCentroid', () => {
  it('incrementally updates centroid correctly', () => {
    const current = new Float32Array([2, 0]);
    const newEmb = new Float32Array([0, 4]);
    const updated = updateCentroid(current, newEmb, 1);
    // (2*1 + 0) / 2 = 1, (0*1 + 4) / 2 = 2
    expect(updated[0]).toBeCloseTo(1, 5);
    expect(updated[1]).toBeCloseTo(2, 5);
  });
});

// ── SimpleEmbedder ────────────────────────────────────────────

describe('SimpleEmbedder', () => {
  const embedder = new SimpleEmbedder();

  it('returns a fixed-size vector', async () => {
    const vec = await embedder.embed('hello world');
    expect(vec.length).toBe(512);
  });

  it('returns normalized vectors', async () => {
    const vec = await embedder.embed('hello world test sentence');
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1, 3);
  });

  it('similar texts have higher similarity', async () => {
    const a = await embedder.embed('write a sorting algorithm in python');
    const b = await embedder.embed('code a sorting function in python');
    const c = await embedder.embed('what is the capital of france');
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it('embedBatch works', async () => {
    const results = await embedder.embedBatch(['hello', 'world']);
    expect(results.length).toBe(2);
    expect(results[0].length).toBe(512);
  });
});

// ── EmbeddingRouter ───────────────────────────────────────────

function makeStrategy(id: string, fitness = 0.5): Strategy {
  return {
    genome: {
      id,
      promptStyle: new Float32Array(4),
      toolPreferences: new Float32Array(4),
      temperature: 0.5,
      maxTokenBudget: 1000,
      reasoningDepth: 0.5,
      mutability: 1.0,
      learningRate: 0.01,
      lamarckianRate: 0.05,
      habitatPref: 0.5,
      fewShotCount: 0,
      promptSegments: [],
      skillRefs: [],
    },
    fitness,
    age: 1,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(),
  };
}

describe('EmbeddingRouter', () => {
  it('gives neutral score to strategies with no history', async () => {
    const embedder = new SimpleEmbedder();
    const router = new EmbeddingRouter(embedder);
    const strategies = [makeStrategy('s1'), makeStrategy('s2')];

    const scores = await router.scoreStrategies('write some code', strategies);
    expect(scores.get('s1')).toBe(0.5);
    expect(scores.get('s2')).toBe(0.5);
  });

  it('routes to strategy with matching history', async () => {
    const embedder = new SimpleEmbedder();
    const router = new EmbeddingRouter(embedder);

    // Build history with distinct vocabulary domains
    await router.recordTask('s1', 'implement sorting algorithm quicksort binary search python function class method', 0.9);
    await router.recordTask('s1', 'debug typescript compiler error variable undefined exception stack trace', 0.8);
    await router.recordTask('s2', 'poem ocean waves sunset beautiful metaphor stanza verse rhyme', 0.9);
    await router.recordTask('s2', 'story adventure narrative character plot chapter beginning ending', 0.8);

    const strategies = [makeStrategy('s1'), makeStrategy('s2')];

    const codingScores = await router.scoreStrategies(
      'implement mergesort algorithm function python debug', strategies,
    );
    const creativeScores = await router.scoreStrategies(
      'poem about nature sunset metaphor verse stanza', strategies,
    );

    // s1 should score higher for coding-heavy query
    expect(codingScores.get('s1')!).toBeGreaterThan(codingScores.get('s2')!);
    // s2 should score higher for creative-heavy query
    expect(creativeScores.get('s2')!).toBeGreaterThan(creativeScores.get('s1')!);
  });

  it('selectBest returns the most relevant strategy', async () => {
    const embedder = new SimpleEmbedder();
    const router = new EmbeddingRouter(embedder);

    await router.recordTask('s1', 'write a sorting algorithm', 0.9);
    await router.recordTask('s2', 'write a poem about nature', 0.9);

    const strategies = [makeStrategy('s1', 0.5), makeStrategy('s2', 0.5)];
    const result = await router.selectBest('implement quicksort', strategies);
    expect(result.strategy.genome.id).toBe('s1');
  });

  it('ignores low-scoring tasks', async () => {
    const embedder = new SimpleEmbedder();
    const router = new EmbeddingRouter(embedder);

    await router.recordTask('s1', 'failed task attempt', 0.2);
    expect(router.getProfile('s1')).toBeUndefined();
  });

  it('hasData reports correctly', async () => {
    const embedder = new SimpleEmbedder();
    const router = new EmbeddingRouter(embedder);

    expect(router.hasData).toBe(false);
    await router.recordTask('s1', 'test task', 0.8);
    expect(router.hasData).toBe(true);
  });
});
