import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrincipleDistiller } from '../src/skills/principle-distiller.js';
import { SkillLibrary, resetSkillCounter } from '../src/skills/skill-library.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import type { LLMAdapter, LLMConfig, LLMResponse, Experience } from '../src/core/types.js';

function makeMockLLM(response = 'Use step-by-step reasoning for complex problems.'): LLMAdapter {
  return {
    execute: vi.fn(async (_prompt: string, _config: LLMConfig): Promise<LLMResponse> => ({
      content: response,
      tokensUsed: 50,
      latencyMs: 100,
    })),
  };
}

function makeExperience(overrides: Partial<Experience> = {}): Experience {
  return {
    strategyId: 'strat_1',
    taskType: 'math',
    taskPrompt: 'What is 2+2?',
    response: 'The answer is 4.',
    score: 0.8,
    tokensUsed: 100,
    latencyMs: 200,
    ...overrides,
  };
}

describe('PrincipleDistiller', () => {
  let store: MemoryStore;
  let library: SkillLibrary;

  beforeEach(() => {
    resetSkillCounter();
    store = new MemoryStore();
    library = new SkillLibrary(store);
  });

  describe('distill — minimum experience guard', () => {
    it('returns null when fewer than minExperiences', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
      });

      // Only 3 experiences
      for (let i = 0; i < 3; i++) {
        await store.recordExperience(makeExperience({ score: 0.7 + i * 0.05 }));
      }

      const result = await distiller.distill('math');
      expect(result).toBeNull();
    });

    it('proceeds when at exactly minExperiences', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 5,
        llmDistillation: false,
      });

      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({ score: 0.5 + i * 0.1 }));
      }

      const result = await distiller.distill('math');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('principle');
    });
  });

  describe('distillSimple — statistical pattern extraction', () => {
    it('detects "use fewer tokens" when top performers use less tokens', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: false,
      });

      // Top scorers: low tokens
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({
          score: 0.9 - i * 0.01,
          tokensUsed: 50,
          response: 'Short.',
        }));
      }
      // Bottom scorers: high tokens
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({
          score: 0.3 + i * 0.01,
          tokensUsed: 500,
          response: 'A very long response that uses many many words to say very little of substance.',
        }));
      }

      const result = await distiller.distill('math');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('fewer tokens');
    });

    it('detects "shorter responses score higher" pattern', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: false,
      });

      // Top scorers: short responses
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({
          score: 0.9,
          tokensUsed: 100,
          response: 'Answer: 42',
        }));
      }
      // Bottom scorers: long responses
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({
          score: 0.2,
          tokensUsed: 100,
          response: 'Well, let me think about this carefully. There are many factors to consider here. First, we need to understand the underlying concepts. The answer involves complex reasoning that spans multiple domains of knowledge. After careful consideration of all angles, I believe the answer might be approximately 42, but I am not entirely sure about this conclusion.',
        }));
      }

      const result = await distiller.distill('math');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('Shorter responses');
    });

    it('detects "more detailed responses score higher" pattern', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: false,
      });

      // Top scorers: long responses
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({
          score: 0.9,
          tokensUsed: 200,
          response: 'Step 1: We identify the variables. Step 2: We set up the equation. Step 3: We solve for x. The detailed solution shows that x = 42. This is verified by substituting back into the original equation.',
        }));
      }
      // Bottom scorers: short responses
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({
          score: 0.2,
          tokensUsed: 200,
          response: '42',
        }));
      }

      const result = await distiller.distill('math');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('More detailed');
    });

    it('includes score range in principle', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: false,
      });

      for (let i = 0; i < 10; i++) {
        await store.recordExperience(makeExperience({ score: 0.1 * i + 0.1 }));
      }

      const result = await distiller.distill('math');
      expect(result).not.toBeNull();
      expect(result!.content).toContain('Top score range');
    });

    it('stores the principle in the skill library', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: false,
      });

      for (let i = 0; i < 10; i++) {
        await store.recordExperience(makeExperience({ score: 0.5 + i * 0.05 }));
      }

      await distiller.distill('math');

      const skills = await library.getSkillsForTask('math');
      expect(skills.length).toBe(1);
      expect(skills[0].type).toBe('principle');
      expect(skills[0].taskTypes).toContain('math');
    });

    it('only considers the specified task type', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 5,
        llmDistillation: false,
      });

      // 10 math experiences
      for (let i = 0; i < 10; i++) {
        await store.recordExperience(makeExperience({ taskType: 'math', score: 0.8 }));
      }
      // 2 coding experiences (below threshold)
      for (let i = 0; i < 2; i++) {
        await store.recordExperience(makeExperience({ taskType: 'coding', score: 0.9 }));
      }

      const mathResult = await distiller.distill('math');
      expect(mathResult).not.toBeNull();

      const codeResult = await distiller.distill('coding');
      expect(codeResult).toBeNull();
    });
  });

  describe('distillWithLLM — LLM-powered distillation', () => {
    it('calls LLM with success/failure examples and stores result', async () => {
      const mockLLM = makeMockLLM('Break problems into smaller sub-problems before solving.');
      const distiller = new PrincipleDistiller(library, store, mockLLM, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: true,
      });

      for (let i = 0; i < 10; i++) {
        await store.recordExperience(makeExperience({
          score: i < 5 ? 0.9 : 0.2,
          taskPrompt: `Problem ${i}`,
          response: `Response ${i}`,
        }));
      }

      const result = await distiller.distill('math');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Break problems into smaller sub-problems before solving.');
      expect(result!.type).toBe('principle');

      // Verify LLM was called with the right structure
      expect(mockLLM.execute).toHaveBeenCalledTimes(1);
      const [prompt] = (mockLLM.execute as any).mock.calls[0];
      expect(prompt).toContain('SUCCESSFUL attempts');
      expect(prompt).toContain('FAILED attempts');
      expect(prompt).toContain('math');
    });

    it('returns null when LLM gives empty response', async () => {
      const mockLLM = makeMockLLM('short');  // < 10 chars
      const distiller = new PrincipleDistiller(library, store, mockLLM, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: true,
      });

      for (let i = 0; i < 10; i++) {
        await store.recordExperience(makeExperience({ score: i < 5 ? 0.9 : 0.2 }));
      }

      const result = await distiller.distill('math');
      expect(result).toBeNull();
    });

    it('falls back to simple when no LLM provided', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: true,  // enabled but no LLM
      });

      for (let i = 0; i < 10; i++) {
        await store.recordExperience(makeExperience({ score: 0.5 + i * 0.05 }));
      }

      const result = await distiller.distill('math');
      // Should fall through to distillSimple since llm is undefined
      expect(result).not.toBeNull();
      expect(result!.content).toContain('math');
    });
  });

  describe('fitness initialization', () => {
    it('sets principle fitness proportional to top scores', async () => {
      const distiller = new PrincipleDistiller(library, store, undefined, {
        minExperiences: 10,
        topN: 5,
        llmDistillation: false,
      });

      // Top 5 average score = 0.9
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({ score: 0.9 }));
      }
      for (let i = 0; i < 5; i++) {
        await store.recordExperience(makeExperience({ score: 0.2 }));
      }

      const result = await distiller.distill('math');
      expect(result).not.toBeNull();
      // fitness = avgTopScore * 0.8 = 0.9 * 0.8 = 0.72
      expect(result!.fitness).toBeCloseTo(0.72, 1);
    });
  });
});
