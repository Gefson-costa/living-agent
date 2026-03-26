import { describe, it, expect, beforeEach } from 'vitest';
import { SkillLibrary, resetSkillCounter } from '../src/skills/skill-library.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import { SimpleEmbedder, cosineSimilarity } from '../src/embeddings/embedder.js';

describe('SkillLibrary — Vector Memory', () => {
  let library: SkillLibrary;
  let store: MemoryStore;
  let embedder: SimpleEmbedder;

  beforeEach(() => {
    resetSkillCounter();
    store = new MemoryStore();
    embedder = new SimpleEmbedder();
    library = new SkillLibrary(store, embedder);
  });

  // ── Semantic retrieval ──────────────────────────────────────

  describe('getSkillsBySimilarity', () => {
    it('retrieves skills by semantic similarity', async () => {
      await library.addSkill('principle', ['coding'], 'Implement sorting algorithms using quicksort and mergesort');
      await library.addSkill('principle', ['writing'], 'Express emotions through romantic sonnets and ballads');
      await library.addSkill('code', ['coding'], 'Implement binary search algorithm for sorted arrays');

      const query = await embedder.embed('implement a sorting algorithm for arrays');
      const results = await library.getSkillsBySimilarity(query);

      // Should retrieve skills — sorting/algorithm skills share many n-grams with query
      expect(results.length).toBeGreaterThan(0);
      // At least one coding skill should appear
      const hasCoding = results.some(r => r.taskTypes.includes('coding'));
      expect(hasCoding).toBe(true);
    });

    it('returns empty when no skills exist', async () => {
      const query = await embedder.embed('anything');
      const results = await library.getSkillsBySimilarity(query);
      expect(results).toEqual([]);
    });

    it('respects similarity threshold', async () => {
      await library.addSkill('principle', ['math'], 'Calculate derivatives using chain rule');

      const query = await embedder.embed('write a romantic poem about the ocean');
      // Very different topic — should be below high threshold
      const results = await library.getSkillsBySimilarity(query, 5, 0.9);
      expect(results.length).toBe(0);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await library.addSkill('principle', ['coding'], `Coding principle number ${i} about algorithms`);
      }

      const query = await embedder.embed('algorithm design patterns');
      const results = await library.getSkillsBySimilarity(query, 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('boosts results by fitness score', async () => {
      // Two distinct skills that both match a query, different fitness
      await library.addSkill('code', ['coding'], 'Implement quicksort partitioning with pivot selection', 0.9);
      await library.addSkill('code', ['coding'], 'Use binary search to find elements in sorted collections', 0.1);

      const query = await embedder.embed('algorithm for searching and sorting data structures');
      const results = await library.getSkillsBySimilarity(query, 5, 0.1);

      // Both should match (shared algorithm/sort/search terms), higher fitness ranks first
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].fitness).toBeGreaterThan(results[1].fitness);
    });

    it('returns skills across task types (cross-task transfer)', async () => {
      // A principle learned from analysis that's also useful for research
      await library.addSkill('principle', ['analysis'], 'Break complex problems into smaller sub-problems');

      const query = await embedder.embed('research complex topic by breaking it down');
      const results = await library.getSkillsBySimilarity(query);

      // Should find the analysis skill even though query is about research
      expect(results.length).toBe(1);
      expect(results[0].taskTypes).toContain('analysis');
    });
  });

  // ── Embedding-based deduplication ──────────────────────────

  describe('embedding dedup', () => {
    it('deduplicates semantically similar skills', async () => {
      await library.addSkill('principle', ['coding'], 'Use functions to organize reusable code blocks');
      const dup = await library.addSkill('principle', ['coding'], 'Organize code into reusable function blocks');

      // Should merge into existing (uses incremented)
      const all = await library.getAllSkills();
      expect(all.length).toBe(1);
      expect(all[0].uses).toBe(1); // incremented from merge
    });

    it('does not merge genuinely different skills', async () => {
      await library.addSkill('principle', ['coding'], 'Use functions to organize reusable code');
      await library.addSkill('principle', ['writing'], 'Write poetry with vivid imagery and metaphors');

      const all = await library.getAllSkills();
      expect(all.length).toBe(2);
    });

    it('merges task types on dedup', async () => {
      await library.addSkill('principle', ['coding'], 'Break problems into smaller sub-problems');
      await library.addSkill('principle', ['analysis'], 'Decompose problems into smaller sub-problems');

      const all = await library.getAllSkills();
      expect(all.length).toBe(1);
      // Should have both task types
      expect(all[0].taskTypes).toContain('coding');
      expect(all[0].taskTypes).toContain('analysis');
    });
  });

  // ── initEmbeddings ─────────────────────────────────────────

  describe('initEmbeddings', () => {
    it('embeds existing skills on init', async () => {
      // Add skills without embedder
      const bareLibrary = new SkillLibrary(store);
      await bareLibrary.addSkill('principle', ['coding'], 'Write clean code');
      await bareLibrary.addSkill('principle', ['math'], 'Show your work step by step');

      // Now create library with embedder and init
      const vecLibrary = new SkillLibrary(store, embedder);
      await vecLibrary.initEmbeddings();

      // Should be able to do semantic retrieval now
      const query = await embedder.embed('write readable maintainable code');
      const results = await vecLibrary.getSkillsBySimilarity(query);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ── setEmbedder ────────────────────────────────────────────

  describe('setEmbedder', () => {
    it('enables vector retrieval after construction', async () => {
      const bareLibrary = new SkillLibrary(store);
      expect(bareLibrary.hasEmbedder()).toBe(false);

      bareLibrary.setEmbedder(embedder);
      expect(bareLibrary.hasEmbedder()).toBe(true);
    });
  });

  // ── Fallback behavior ──────────────────────────────────────

  describe('fallback without embedder', () => {
    it('getSkillsBySimilarity returns empty without embeddings', async () => {
      const bareLibrary = new SkillLibrary(store);
      await bareLibrary.addSkill('principle', ['coding'], 'Write clean code');

      const query = await embedder.embed('clean code');
      const results = await bareLibrary.getSkillsBySimilarity(query);
      expect(results).toEqual([]);
    });

    it('still supports task-type retrieval without embedder', async () => {
      const bareLibrary = new SkillLibrary(store);
      await bareLibrary.addSkill('principle', ['coding'], 'Write clean code');

      const results = await bareLibrary.getSkillsForTask('coding');
      expect(results.length).toBe(1);
    });
  });

  // ── Embedding cache management ─────────────────────────────

  describe('embedding cache', () => {
    it('caches embeddings for new skills', async () => {
      const skill = await library.addSkill('principle', ['coding'], 'Use descriptive variable names');
      const emb = library.getEmbedding(skill.id);
      expect(emb).not.toBeNull();
      expect(emb!.length).toBe(embedder.dimensions);
    });

    it('cleans up embeddings on prune', async () => {
      const skill = await library.addSkill('principle', ['coding'], 'Bad skill', 0.05);
      expect(library.getEmbedding(skill.id)).not.toBeNull();

      await library.pruneSkills(0.1);
      expect(library.getEmbedding(skill.id)).toBeNull();
    });
  });
});
