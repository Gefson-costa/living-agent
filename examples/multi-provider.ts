/**
 * Multi-provider — Use DeepSeek, Groq, or Ollama instead of Anthropic.
 *
 * Run with DeepSeek:  DEEPSEEK_API_KEY=sk-... npx tsx examples/multi-provider.ts deepseek
 * Run with Groq:      GROQ_API_KEY=gsk_... npx tsx examples/multi-provider.ts groq
 * Run with Ollama:    npx tsx examples/multi-provider.ts ollama
 */

import {
  LivingAgent,
  OpenAICompatibleAdapter,
  MemoryStore,
} from '@kanano/living-agent';

const provider = (process.argv[2] ?? 'deepseek') as 'deepseek' | 'groq' | 'ollama';

console.log(`Using provider: ${provider}\n`);

const llm = new OpenAICompatibleAdapter({ provider });
const store = new MemoryStore();

const agent = new LivingAgent(llm, store, {
  strategyCount: 6,
  consolidateEvery: 10,
});

await agent.init();

const response = await agent.chat('What are the top 3 benefits of evolutionary algorithms?');
console.log(response);
