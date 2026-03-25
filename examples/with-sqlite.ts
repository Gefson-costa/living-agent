/**
 * Persistent agent — Strategies survive across restarts via SQLite.
 *
 * Run:  ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/with-sqlite.ts
 * Mock: npx tsx examples/with-sqlite.ts --mock
 *
 * Run it multiple times — the agent picks up where it left off.
 */

import {
  LivingAgent,
  AnthropicAdapter,
  MockAdapter,
  SqliteStore,
} from '@kanano/living-agent';

const useMock = process.argv.includes('--mock');

const llm = useMock ? new MockAdapter() : new AnthropicAdapter();
const store = new SqliteStore('my-agent.sqlite');

const agent = new LivingAgent(llm, store, {
  strategyCount: 8,
  consolidateEvery: 15,
});

await agent.init();

const status = agent.getStatus();
console.log(`Loaded ${status.strategyCount} strategies (avg fitness: ${status.avgFitness.toFixed(3)})`);

// Interactive loop
const readline = await import('node:readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (prompt: string) => new Promise<string>(resolve => rl.question(prompt, resolve));

console.log('\nType a message (or "quit" to exit):\n');

while (true) {
  const input = await ask('> ');
  if (input.toLowerCase() === 'quit') break;

  const response = await agent.chat(input);
  console.log(`\n${response}\n`);
}

store.close();
rl.close();
