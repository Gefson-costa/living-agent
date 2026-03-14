import { describe, it, expect, beforeEach } from 'vitest';
import { LivingAgent } from '../src/agent/living-agent.js';
import { MockAdapter } from '../src/llm/adapter.js';
import { MemoryStore } from '../src/storage/memory-store.js';
import { resetGenomeCounter } from '../src/evolution/genome.js';
import { resetSkillCounter } from '../src/skills/skill-library.js';

describe('LivingAgent', () => {
  let agent: LivingAgent;

  beforeEach(async () => {
    resetGenomeCounter();
    resetSkillCounter();
    agent = new LivingAgent(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
      toolNames: ['search', 'code'],
      consolidateEvery: 5,
    });
    await agent.init();
  });

  // ── Initialization ──────────────────────────────────────────

  it('initializes with correct strategy count', () => {
    expect(agent.getStrategies().length).toBe(4);
  });

  it('all strategies have birth weights after init', () => {
    for (const s of agent.getStrategies()) {
      expect(s.birthWeights).not.toBeNull();
    }
  });

  it('starts with zero interactions', () => {
    const status = agent.getStatus();
    expect(status.totalInteractions).toBe(0);
    expect(status.consolidations).toBe(0);
  });

  // ── Chat ────────────────────────────────────────────────────

  it('responds to a message', async () => {
    const response = await agent.chat('What is 2 + 3?');
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });

  it('increments interaction counter', async () => {
    await agent.chat('Hello');
    await agent.chat('How are you?');
    expect(agent.getStatus().totalInteractions).toBe(2);
  });

  it('records interactions in history', async () => {
    await agent.chat('Write a function to add numbers');
    const interactions = agent.getInteractions();
    expect(interactions.length).toBe(1);
    expect(interactions[0].taskType).toBe('coding');
  });

  it('classifies tasks correctly in interactions', async () => {
    await agent.chat('Summarize this document');
    const interactions = agent.getInteractions();
    expect(interactions[0].taskType).toBe('summarization');
  });

  it('updates strategy fitness after chat', async () => {
    const initialFitnesses = agent.getStrategies().map(s => s.fitness);
    await agent.chat('What is 10 + 20?');
    const updatedFitnesses = agent.getStrategies().map(s => s.fitness);

    // At least one strategy should have changed fitness
    const changed = updatedFitnesses.some((f, i) => f !== initialFitnesses[i]);
    expect(changed).toBe(true);
  });

  it('tracks task type distribution', async () => {
    await agent.chat('Write a function');
    await agent.chat('Summarize this');
    await agent.chat('Write another function');

    const status = agent.getStatus();
    expect(status.taskTypeDistribution['coding']).toBe(2);
    expect(status.taskTypeDistribution['summarization']).toBe(1);
  });

  // ── Feedback ────────────────────────────────────────────────

  it('applies user feedback to pending interaction', async () => {
    await agent.chat('What is 5 + 5?');
    const applied = await agent.applyFeedback(8);
    expect(applied).toBe(true);

    const interactions = agent.getInteractions();
    expect(interactions[0].userFeedback).toBe(0.8);
  });

  it('returns false when no pending feedback', async () => {
    const applied = await agent.applyFeedback(5);
    expect(applied).toBe(false);
  });

  it('clamps feedback to 0-10 range', async () => {
    await agent.chat('Hello');
    await agent.applyFeedback(15);  // Should clamp to 10/10 = 1.0

    const interactions = agent.getInteractions();
    expect(interactions[0].userFeedback).toBe(1);
  });

  it('closes pending feedback on next chat', async () => {
    await agent.chat('First message');
    // Don't give feedback
    await agent.chat('Second message');

    const interactions = agent.getInteractions();
    expect(interactions[0].userFeedback).toBeNull();
    expect(interactions.length).toBe(2);
  });

  // ── Engagement ────────────────────────────────────────────

  it('computes auto-engagement on second chat', async () => {
    await agent.chat('Hello there');
    await agent.chat('That was really helpful, tell me more!');

    const interactions = agent.getInteractions();
    // First interaction should now have engagement data from the second message
    expect(interactions[0].engagementScore).not.toBeNull();
    expect(interactions[0].engagementScore).toBeGreaterThan(0);
    expect(interactions[0].engagementMetrics).not.toBeNull();
    expect(interactions[0].engagementMetrics!.replied).toBe(true);
  });

  it('detects dismissive reply in engagement', async () => {
    await agent.chat('Hello there');
    await agent.chat('ok');

    const interactions = agent.getInteractions();
    expect(interactions[0].engagementMetrics).not.toBeNull();
    expect(interactions[0].engagementMetrics!.dismissed).toBe(true);
  });

  it('reportEngagement sets emoji reaction', async () => {
    await agent.chat('Tell me a joke');
    agent.reportEngagement({ emojiReaction: true });
    await agent.chat('That was funny!');

    const interactions = agent.getInteractions();
    expect(interactions[0].engagementMetrics).not.toBeNull();
    expect(interactions[0].engagementMetrics!.emojiReaction).toBe(true);
  });

  it('reportNoReply sets low engagement', async () => {
    await agent.chat('Hello');
    await agent.reportNoReply();

    const interactions = agent.getInteractions();
    expect(interactions[0].engagementScore).toBe(0.1);
    expect(interactions[0].engagementMetrics).not.toBeNull();
    expect(interactions[0].engagementMetrics!.replied).toBe(false);
  });

  it('reportNoReply is no-op without pending interaction', async () => {
    // Should not throw
    await agent.reportNoReply();
  });

  it('clearHistory resets sessionTurnCount', async () => {
    await agent.chat('Message 1');
    await agent.chat('Message 2');
    agent.clearHistory();

    // After clearHistory, turn count resets to 0. The next chat() finalizes
    // interaction[1] before incrementing, so turnCount=0 at finalization time.
    await agent.chat('New conversation');
    const interactions = agent.getInteractions();
    expect(interactions[1].engagementMetrics).not.toBeNull();
    expect(interactions[1].engagementMetrics!.turnCount).toBe(0);
  });

  // ── Consolidation ──────────────────────────────────────────

  it('triggers consolidation after configured interactions', async () => {
    // consolidateEvery = 5
    for (let i = 0; i < 5; i++) {
      await agent.chat(`Message ${i}`);
    }
    expect(agent.getStatus().consolidations).toBe(1);
  });

  it('manual consolidation works', async () => {
    await agent.chat('Hello');
    await agent.runConsolidation();
    expect(agent.getStatus().consolidations).toBe(1);
  });

  // ── Status ─────────────────────────────────────────────────

  it('getStatus returns valid structure', () => {
    const status = agent.getStatus();
    expect(status.strategyCount).toBe(4);
    expect(typeof status.avgFitness).toBe('number');
    expect(typeof status.bestFitness).toBe('number');
    expect(typeof status.bestStrategyId).toBe('string');
    expect(typeof status.mapElitesCoverage).toBe('number');
    expect(typeof status.noveltyArchiveSize).toBe('number');
  });

  it('getFullStatus includes skill count', async () => {
    const status = await agent.getFullStatus();
    expect(typeof status.skillCount).toBe('number');
  });

  // ── Conversation History ─────────────────────────────────

  it('builds conversation history across messages', async () => {
    await agent.chat('Hello');
    await agent.chat('How are you?');

    const history = agent.getHistory();
    expect(history.length).toBe(4); // 2 user + 2 assistant
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('Hello');
    expect(history[1].role).toBe('assistant');
    expect(history[2].role).toBe('user');
    expect(history[2].content).toBe('How are you?');
    expect(history[3].role).toBe('assistant');
  });

  it('clearHistory resets conversation', async () => {
    await agent.chat('Hello');
    expect(agent.getHistory().length).toBe(2);

    agent.clearHistory();
    expect(agent.getHistory().length).toBe(0);
  });

  it('trims history to maxHistoryTurns', async () => {
    const smallAgent = new LivingAgent(new MockAdapter(), new MemoryStore(), {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
      toolNames: ['search', 'code'],
      consolidateEvery: 100,
      maxHistoryTurns: 2,  // keep only 2 turns (4 messages)
    });
    await smallAgent.init();

    await smallAgent.chat('Message 1');
    await smallAgent.chat('Message 2');
    await smallAgent.chat('Message 3');

    const history = smallAgent.getHistory();
    // Should have trimmed to last 2 turns (4 messages)
    expect(history.length).toBe(4);
    expect(history[0].content).toBe('Message 2');
    expect(history[2].content).toBe('Message 3');
  });

  // ── Persistence ────────────────────────────────────────────

  it('save and reload preserves state', async () => {
    const store = new MemoryStore();
    const agent1 = new LivingAgent(new MockAdapter(), store, {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
      toolNames: ['search', 'code'],
    });
    await agent1.init();
    await agent1.chat('What is 2 + 2?');
    await agent1.save();

    // Create new agent with same store
    resetGenomeCounter();
    const agent2 = new LivingAgent(new MockAdapter(), store, {
      strategyCount: 4,
      promptStyleDim: 4,
      toolCount: 2,
      toolNames: ['search', 'code'],
    });
    await agent2.init();

    // Should have loaded strategies from store
    expect(agent2.getStrategies().length).toBe(4);
  });

  // ── Multiple interactions ──────────────────────────────────

  it('handles 10 interactions without errors', async () => {
    const messages = [
      'What is 1 + 1?',
      'Write a sorting function',
      'Summarize quantum physics',
      'Compare cats and dogs',
      'Tell me a story',
      'Debug this code',
      'What is machine learning?',
      'Analyze market trends',
      'Hello there',
      'Create a poem',
    ];

    for (const msg of messages) {
      const response = await agent.chat(msg);
      expect(response.length).toBeGreaterThan(0);
    }

    expect(agent.getStatus().totalInteractions).toBe(10);
    expect(agent.getInteractions().length).toBe(10);
    // Should have consolidated twice (at 5 and 10)
    expect(agent.getStatus().consolidations).toBe(2);
  });
});
