// ================================================================
//  Embedder — Local embedding provider via Ollama
//
//  Converts text to vectors using Ollama's embedding endpoint.
//  Falls back to simple TF-IDF-like bag-of-words when unavailable.
//
//  Ref: evolution.md #31 — embeddings for local eval & routing
// ================================================================

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
}

// ── Ollama Embedder ───────────────────────────────────────────

export class OllamaEmbedder implements Embedder {
  private baseUrl: string;
  private model: string;
  readonly dimensions: number;

  constructor(config: { baseUrl?: string; model?: string; dimensions?: number } = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.model = config.model ?? 'nomic-embed-text';
    this.dimensions = config.dimensions ?? 768;
  }

  async embed(text: string): Promise<Float32Array> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);

    const data = await res.json() as { embedding: number[] };
    return new Float32Array(data.embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Ollama doesn't batch well — sequential is fine for local
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

// ── Simple fallback embedder (no external deps) ───────────────
//
// Uses character n-gram hashing (fastText-style) instead of whole-word
// hashing. This captures morphological similarity: "sort", "sorting",
// "sorted" share character n-grams and activate overlapping buckets.
// Also hashes word bigrams for local context.

const VOCAB_SIZE = 512;

export class SimpleEmbedder implements Embedder {
  readonly dimensions = VOCAB_SIZE;

  async embed(text: string): Promise<Float32Array> {
    return charNgramHash(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(t => charNgramHash(t));
  }
}

/** FNV-1a inspired hash — fast, good distribution. */
function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) | 0;
  }
  return h >>> 0;
}

function charNgramHash(text: string): Float32Array {
  const vec = new Float32Array(VOCAB_SIZE);
  const clean = text.toLowerCase().replace(/[^\w\s]/g, '');
  const words = clean.split(/\s+/).filter(w => w.length >= 2);

  for (const word of words) {
    // Whole word (weight 1.0)
    vec[fnv(word) % VOCAB_SIZE] += 1.0;

    // Character n-grams: 3 to 6 chars (weight 0.5)
    // Wraps word in < > markers for prefix/suffix distinction
    const padded = `<${word}>`;
    for (let n = 3; n <= 6; n++) {
      for (let i = 0; i <= padded.length - n; i++) {
        const gram = padded.substring(i, i + n);
        vec[fnv(gram) % VOCAB_SIZE] += 0.5;
      }
    }
  }

  // Word bigrams (weight 0.7) — captures local context
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`;
    vec[fnv(bigram) % VOCAB_SIZE] += 0.7;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

// ── Vector utils ──────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Compute the centroid (mean) of multiple embeddings. */
export function centroid(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(0);
  const dim = embeddings[0].length;
  const sum = new Float32Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) sum[i] += emb[i];
  }
  const n = embeddings.length;
  for (let i = 0; i < dim; i++) sum[i] /= n;
  return sum;
}

/** Incrementally update a centroid with a new embedding. */
export function updateCentroid(
  current: Float32Array,
  newEmb: Float32Array,
  count: number,
): Float32Array {
  const dim = current.length;
  const updated = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    updated[i] = (current[i] * count + newEmb[i]) / (count + 1);
  }
  return updated;
}

// ── Factory ───────────────────────────────────────────────────

/** Create an embedder — tries Ollama first, falls back to simple. */
export async function createEmbedder(
  config: { baseUrl?: string; model?: string } = {},
): Promise<Embedder> {
  const ollama = new OllamaEmbedder(config);
  try {
    // Quick probe with 500ms timeout — Ollama local responds in <50ms
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`${config.baseUrl ?? 'http://localhost:11434'}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model ?? 'nomic-embed-text', prompt: 'test' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as { embedding: number[] };
      if (data.embedding?.length > 0) return ollama;
    }
  } catch {
    // Ollama not available — fall back silently
  }
  return new SimpleEmbedder();
}
