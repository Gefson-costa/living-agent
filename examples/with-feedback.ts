/**
 * Feedback loop — Demonstrate how user feedback accelerates evolution.
 *
 * Run:  ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/with-feedback.ts
 * Mock: npx tsx examples/with-feedback.ts --mock
 */

import {
  LivingAgent,
  AnthropicAdapter,
  MockAdapter,
  MemoryStore,
} from '@kanano/living-agent';

const useMock = process.argv.includes('--mock');

const llm = useMock ? new MockAdapter() : new AnthropicAdapter();
const store = new MemoryStore();

const agent = new LivingAgent(llm, store, {
  strategyCount: 8,
  consolidateEvery: 10,
});

await agent.init();

// Simulate 20 interactions with explicit feedback
for (let i = 0; i < 20; i++) {
  const task = i % 2 === 0
    ? `What is ${10 + i} * ${3 + i}?`
    : `Explain concept #${i} briefly.`;

  const response = await agent.chat(task);

  // Simulate user feedback: math gets 8/10, explanations get 6/10
  const feedback = i % 2 === 0 ? 8 : 6;
  await agent.applyFeedback(feedback);

  if ((i + 1) % 5 === 0) {
    const s = agent.getStatus();
    console.log(`After ${i + 1} interactions — avg fitness: ${s.avgFitness.toFixed(3)}, best: ${s.bestFitness.toFixed(3)}`);
  }
}

// Final status
const status = agent.getStatus();
console.log('\n--- Final Status ---');
console.log(`Avg Fitness: ${status.avgFitness.toFixed(3)}`);
console.log(`Best Fitness: ${status.bestFitness.toFixed(3)}`);
console.log(`Population health: ${status.populationHealth}`);
console.log(`Task distribution:`, status.taskTypeDistribution);
