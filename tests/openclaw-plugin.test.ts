import { describe, it, expect, beforeEach } from 'vitest';
import { createLivingAgentPlugin } from '../src/integrations/openclaw/plugin.js';
import { MockAdapter } from '../src/llm/adapter.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import { resetGenomeCounter } from '../src/evolution/genome.js';
import { resetSkillCounter } from '../src/skills/skill-library.js';

describe('OpenClaw Plugin', () => {
  beforeEach(() => {
    resetGenomeCounter();
    resetSkillCounter();
  });

  it('creates and initializes a plugin', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    const status = await plugin.status();
    expect(status.strategyCount).toBe(4);
    expect(status.totalInteractions).toBe(0);
  });

  it('chat returns a response', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    const response = await plugin.chat('What is 2 + 3?');
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });

  it('getOptimizedConfig returns valid config', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    const config = plugin.getOptimizedConfig('Write a function to sort an array');
    expect(config.taskType).toBe('coding');
    expect(typeof config.temperature).toBe('number');
    expect(typeof config.maxTokens).toBe('number');
    expect(typeof config.systemPrompt).toBe('string');
    expect(config.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof config.strategyId).toBe('string');
    expect(typeof config.fitness).toBe('number');
    expect(typeof config.expertise).toBe('number');
  });

  it('classifies different task types correctly', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    expect(plugin.getOptimizedConfig('Summarize this article').taskType).toBe('summarization');
    expect(plugin.getOptimizedConfig('Analyze the data').taskType).toBe('analysis');
    expect(plugin.getOptimizedConfig('Write a poem').taskType).toBe('creative');
  });

  it('feedback works after chat', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    await plugin.chat('Hello');
    const applied = await plugin.feedback(8);
    expect(applied).toBe(true);
  });

  it('reportEngagement delegates to agent', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    await plugin.chat('Tell me a joke');
    // Should not throw
    plugin.reportEngagement({ emojiReaction: true });
  });

  it('reportNoReply delegates to agent', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    await plugin.chat('Hello');
    await plugin.reportNoReply();

    // Feedback should now return false since reportNoReply cleared the pending interaction
    const applied = await plugin.feedback(5);
    expect(applied).toBe(false);
  });

  it('feedback returns false when no pending interaction', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    const applied = await plugin.feedback(5);
    expect(applied).toBe(false);
  });

  it('principles returns empty array initially', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    const principles = await plugin.principles();
    expect(principles).toEqual([]);
  });

  it('consolidate runs without error', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();

    await plugin.chat('Test message');
    await plugin.consolidate();

    const status = await plugin.status();
    expect(status.consolidations).toBe(1);
  });

  it('save runs without error', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
    });
    await plugin.init();
    await plugin.save();
  });

  it('full workflow: chat -> feedback -> consolidate -> status', async () => {
    const plugin = createLivingAgentPlugin(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
      consolidateEvery: 3,
    });
    await plugin.init();

    await plugin.chat('Write a sorting function');
    await plugin.feedback(9);

    await plugin.chat('Explain quantum computing');
    await plugin.feedback(7);

    await plugin.chat('Summarize this text');
    // consolidation triggers at interaction 3

    const status = await plugin.status();
    expect(status.totalInteractions).toBe(3);
    expect(status.consolidations).toBe(1);
    expect(status.taskTypeDistribution).toHaveProperty('coding');
    expect(status.taskTypeDistribution).toHaveProperty('research');
    expect(status.taskTypeDistribution).toHaveProperty('summarization');
  });
});
