// ================================================================
//  Auto-detect the best available LLM adapter for benchmarks.
//
//  Priority: ANTHROPIC_API_KEY > DEEPSEEK_API_KEY > OPENROUTER_API_KEY
//  Includes preflight check to skip depleted/broken APIs.
// ================================================================

import 'dotenv/config';
import type { LLMAdapter } from '../src/core/types.js';
import { AnthropicAdapter, OpenAICompatibleAdapter } from '../src/llm/adapter.js';

export interface AdapterInfo {
  adapter: LLMAdapter;
  name: string;
  model: string;
}

/** Preflight: send a trivial request. Returns true if adapter works. */
async function preflight(adapter: LLMAdapter): Promise<boolean> {
  try {
    const res = await adapter.execute('Reply with just "ok"', {
      temperature: 0, maxTokens: 16,
      systemPrompt: 'Reply with exactly "ok"', toolNames: [],
    });
    // Must get actual tokens back — error/mock responses return 0
    return res.tokensUsed > 0;
  } catch {
    return false;
  }
}

/** Parse --ollama and --model= from CLI args for benchmarks. */
function getOllamaOverride(): { model: string } | null {
  const args = process.argv.slice(2);
  if (!args.includes('--ollama')) return null;
  const modelArg = args.find(a => a.startsWith('--model='));
  return { model: modelArg?.slice(8) ?? 'llama3' };
}

/** Create the best available adapter, with preflight verification. */
export async function createBenchmarkAdapter(): Promise<AdapterInfo | null> {
  // Ollama override: --ollama --model=qwen3:8b
  const ollama = getOllamaOverride();
  if (ollama) {
    const adapter = new OpenAICompatibleAdapter({ provider: 'ollama', model: ollama.model });
    console.log(`  [Adapter] Trying Ollama (${ollama.model})...`);
    const ok = await preflight(adapter);
    if (ok) {
      console.log(`  [Adapter] Ollama — OK`);
      return { adapter, name: 'Ollama', model: ollama.model };
    }
    console.log(`  [Adapter] Ollama — failed preflight. Is Ollama running?`);
    return null;
  }

  const candidates: Array<{ create: () => LLMAdapter; name: string; model: string; envKey: string }> = [
    {
      envKey: 'ANTHROPIC_API_KEY',
      create: () => new AnthropicAdapter(),
      name: 'Anthropic',
      model: 'claude-haiku-4-5',
    },
    {
      envKey: 'DEEPSEEK_API_KEY',
      create: () => new OpenAICompatibleAdapter({ provider: 'deepseek' }),
      name: 'DeepSeek',
      model: 'deepseek-chat (V3)',
    },
    {
      envKey: 'OPENROUTER_API_KEY',
      create: () => new AnthropicAdapter(),
      name: 'OpenRouter',
      model: 'anthropic/claude-3.5-haiku',
    },
    {
      envKey: 'TOGETHER_API_KEY',
      create: () => new OpenAICompatibleAdapter({ provider: 'together' }),
      name: 'Together',
      model: 'llama-3.1-8b',
    },
    {
      envKey: 'GROQ_API_KEY',
      create: () => new OpenAICompatibleAdapter({ provider: 'groq' }),
      name: 'Groq',
      model: 'llama-3.1-8b',
    },
  ];

  for (const c of candidates) {
    if (!process.env[c.envKey]) continue;

    const adapter = c.create();
    // Allow async constructor init (AnthropicAdapter uses dynamic import)
    await new Promise(r => setTimeout(r, 300));

    console.log(`  [Adapter] Trying ${c.name} (${c.model})...`);
    const ok = await preflight(adapter);
    if (ok) {
      console.log(`  [Adapter] ${c.name} — OK`);
      return { adapter, name: c.name, model: c.model };
    }
    console.log(`  [Adapter] ${c.name} — failed preflight, trying next...`);
  }

  return null;
}

/** Returns true if --ollama flag is present. */
export function isOllamaMode(): boolean {
  return process.argv.includes('--ollama');
}

export function hasAnyApiKey(): boolean {
  return !!(
    process.argv.includes('--ollama') ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.TOGETHER_API_KEY ||
    process.env.GROQ_API_KEY
  );
}
