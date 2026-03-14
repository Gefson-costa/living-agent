import { describe, it, expect } from 'vitest';
import { classifyTask } from '../src/agent/task-classifier.js';
import { ClassifierMemory } from '../src/agent/classifier-memory.js';

describe('classifyTask', () => {
  // ── Coding ─────────────────────────────────────────────────
  it('classifies "write a function" as coding', () => {
    expect(classifyTask('Write a function to sort an array')).toBe('coding');
  });

  it('classifies code blocks as coding', () => {
    expect(classifyTask('Fix this:\n```\nconst x = 1\n```')).toBe('coding');
  });

  it('classifies debug requests as coding', () => {
    expect(classifyTask('Debug this error in my Python script')).toBe('coding');
  });

  it('classifies refactoring as coding', () => {
    expect(classifyTask('Refactor the class to use dependency injection')).toBe('coding');
  });

  it('classifies language-specific mentions as coding', () => {
    expect(classifyTask('How do I use async/await in TypeScript?')).toBe('coding');
  });

  // ── Research ───────────────────────────────────────────────
  it('classifies "what is" questions as research', () => {
    expect(classifyTask('What is quantum computing?')).toBe('research');
  });

  it('classifies "explain" requests as research', () => {
    expect(classifyTask('Explain the theory of relativity')).toBe('research');
  });

  it('classifies "tell me about" as research', () => {
    expect(classifyTask('Tell me about the history of Rome')).toBe('research');
  });

  // ── Analysis ───────────────────────────────────────────────
  it('classifies comparison requests as analysis', () => {
    expect(classifyTask('Compare React vs Vue for a large app')).toBe('analysis');
  });

  it('classifies "analyze" as analysis', () => {
    expect(classifyTask('Analyze the trade-offs of microservices')).toBe('analysis');
  });

  it('classifies evaluation as analysis', () => {
    expect(classifyTask('Evaluate the pros and cons of remote work')).toBe('analysis');
  });

  // ── Creative ───────────────────────────────────────────────
  it('classifies story writing as creative', () => {
    expect(classifyTask('Write a short story about a robot')).toBe('creative');
  });

  it('classifies poem requests as creative', () => {
    expect(classifyTask('Compose a poem about the sea')).toBe('creative');
  });

  it('classifies brainstorming as creative', () => {
    expect(classifyTask('Brainstorm names for my startup')).toBe('creative');
  });

  // ── Summarization ──────────────────────────────────────────
  it('classifies "summarize" as summarization', () => {
    expect(classifyTask('Summarize this article for me')).toBe('summarization');
  });

  it('classifies "tldr" as summarization', () => {
    expect(classifyTask('Give me the TL;DR of this paper')).toBe('summarization');
  });

  it('classifies "key points" as summarization', () => {
    expect(classifyTask('What are the key points of this document?')).toBe('summarization');
  });

  // ── General ────────────────────────────────────────────────
  it('falls back to general for unclassifiable input', () => {
    expect(classifyTask('Hello!')).toBe('general');
  });

  it('falls back to general for vague messages', () => {
    expect(classifyTask('Thanks, that looks good')).toBe('general');
  });

  // ── Ambiguity resolution ───────────────────────────────────
  it('prefers coding over creative for "write a function"', () => {
    expect(classifyTask('Write a function to validate emails')).toBe('coding');
  });

  it('prefers creative for "write a story"', () => {
    expect(classifyTask('Write a story about a magical forest')).toBe('creative');
  });

  // ── New disambiguation tests ───────────────────────────────
  it('prefers coding when language-specific terms coexist with research triggers', () => {
    expect(classifyTask('How do I implement a binary search in JavaScript?')).toBe('coding');
  });

  it('prefers analysis over research for comparison tasks', () => {
    expect(classifyTask('What are the differences between REST and GraphQL?')).toBe('analysis');
  });

  it('handles mixed coding+creative by checking exclusive terms', () => {
    expect(classifyTask('Create a class to generate random poems')).toBe('coding');
    expect(classifyTask('Create a poem about random classes in school')).toBe('creative');
  });

  // ── Classifier Memory Learning ────────────────────────────
  it('classifier memory shifts bias after repeated reinforcement', () => {
    const memory = new ClassifierMemory(0.3); // high learning rate for test

    // Repeatedly reinforce "design" as a coding task with high scores
    for (let i = 0; i < 20; i++) {
      memory.adjustWeights('help me design the system', 'coding', 0.9);
    }

    // The boost should now favor coding when "design" appears
    const codingBoost = memory.getMessageBoost('help me design the system', 'coding');
    const creativeBoost = memory.getMessageBoost('help me design the system', 'creative');
    expect(codingBoost).toBeGreaterThan(creativeBoost);
    expect(codingBoost).toBeGreaterThan(0);
  });

  it('classifier memory serializes and deserializes', () => {
    const memory = new ClassifierMemory();
    memory.adjustWeights('debug the function', 'coding', 0.9);
    memory.adjustWeights('write a story', 'creative', 0.8);

    const serialized = memory.serialize();
    const restored = ClassifierMemory.deserialize(serialized);

    expect(restored.getBoost('debug', 'coding')).toBeCloseTo(
      memory.getBoost('debug', 'coding'),
    );
    expect(restored.getBoost('story', 'creative')).toBeCloseTo(
      memory.getBoost('story', 'creative'),
    );
  });
});
