/**
 * Quickstart — Minimal example of a Living Agent.
 *
 * Run:  ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/quickstart.ts
 * Mock: npx tsx examples/quickstart.ts --mock
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
  strategyCount: 6,
  consolidateEvery: 10,
});

await agent.init();

// Have a few conversations
const questions = [
  'What is 15 * 23?',
  'Explain quicksort in one paragraph.',
  'Write a Python function that reverses a string.',
  'Summarize the theory of relativity in 3 sentences.',
  'What are the pros and cons of microservices?',
];

for (const q of questions) {
  console.log(`\n> ${q}`);
  const response = await agent.chat(q);
  console.log(response.slice(0, 200) + (response.length > 200 ? '...' : ''));
}

// Check how strategies evolved
const status = agent.getStatus();
console.log('\n--- Agent Status ---');
console.log(`Strategies: ${status.strategyCount}`);
console.log(`Avg Fitness: ${status.avgFitness.toFixed(3)}`);
console.log(`Best Fitness: ${status.bestFitness.toFixed(3)}`);
console.log(`Task distribution:`, status.taskTypeDistribution);
