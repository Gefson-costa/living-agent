// ================================================================
//  LLM Adapters — Mock + Anthropic
//
//  MockAdapter: deterministic scoring for tests & dev
//  AnthropicAdapter: real LLM calls via @anthropic-ai/sdk
// ================================================================

import type { LLMAdapter, LLMConfig, LLMResponse, StrategyGenome } from '../core/types.js';

/** Build a system prompt modulated by the genome's promptStyle vector */
export function buildSystemPrompt(
  template: string,
  genome: StrategyGenome,
  toolNames: string[],
  taskTypeMemory?: Map<string, number>,
): string {
  const style = genome.promptStyle;
  const emphases: string[] = [];

  const traits = [
    'precise', 'creative', 'concise', 'thorough',
    'cautious', 'bold', 'analytical', 'intuitive',
  ];
  for (let i = 0; i < Math.min(style.length, traits.length); i++) {
    if (style[i] > 0.3) emphases.push(`Be ${traits[i]}.`);
  }

  // Tool preferences: highlight preferred tools
  const preferredTools: string[] = [];
  for (let i = 0; i < Math.min(genome.toolPreferences.length, toolNames.length); i++) {
    if (genome.toolPreferences[i] > 0.6) {
      preferredTools.push(toolNames[i]);
    }
  }

  let prompt = template;

  // Reasoning depth modulation (5 graduated levels)
  const depth = genome.reasoningDepth;
  if (depth > 0.8) {
    prompt += '\n\nThink deeply step-by-step, consider multiple approaches before answering.';
  } else if (depth > 0.6) {
    prompt += '\n\nThink step-by-step, show your reasoning.';
  } else if (depth > 0.4) {
    prompt += '\n\nBriefly outline your reasoning, then answer.';
  } else if (depth > 0.2) {
    prompt += '\n\nBe concise, minimal explanation.';
  } else {
    prompt += '\n\nBe direct, answer immediately.';
  }

  if (emphases.length > 0) {
    prompt += '\nStyle: ' + emphases.join(' ');
  }
  if (preferredTools.length > 0) {
    prompt += '\nPreferred tools: ' + preferredTools.join(', ');
  }

  if (taskTypeMemory && taskTypeMemory.size > 0) {
    const expertiseLines: string[] = [];
    for (const [type, score] of taskTypeMemory) {
      if (score > 0.6) {
        expertiseLines.push(`Expertise: ${type} (${(score * 100).toFixed(0)}%).`);
      }
    }
    if (expertiseLines.length > 0) {
      prompt += '\n' + expertiseLines.join(' ');
    }
  }

  return prompt;
}

/** Build LLM config from a strategy genome */
export function genomeToLLMConfig(
  genome: StrategyGenome,
  systemPromptTemplate: string,
  toolNames: string[],
): LLMConfig {
  return {
    temperature: genome.temperature,
    maxTokens: genome.maxTokenBudget,
    systemPrompt: buildSystemPrompt(systemPromptTemplate, genome, toolNames),
    toolNames,
  };
}

// ── Mock Adapter ────────────────────────────────────────────────

export class MockAdapter implements LLMAdapter {
  async execute(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    const seed = hashStr(prompt) ^ hashStr(config.systemPrompt) ^ floatBits(config.temperature);
    let rngState = seed;
    const rng = () => {
      rngState = Math.imul(rngState ^ (rngState >>> 15), rngState | 1);
      rngState ^= rngState + Math.imul(rngState ^ (rngState >>> 7), rngState | 61);
      return ((rngState ^ (rngState >>> 14)) >>> 0) / 4294967296;
    };

    const latencyMs = 50 + (config.maxTokens / 40) | 0;
    const tokensUsed = Math.max(10, (config.maxTokens * (0.3 + rng() * 0.5)) | 0);

    // Temperature sweet spot: 0.3..0.8 is optimal for math
    const tempFitness = 1 - Math.pow(Math.abs(config.temperature - 0.5) / 1.5, 0.8);

    // System prompt quality: more structure helps
    const promptQuality = Math.min(0.2, config.systemPrompt.length / 1500);

    // Extract any numbers from the prompt for math-like tasks
    const numbers = prompt.match(/-?\d+\.?\d*/g);
    let response = `${rng() * 100}`;

    if (numbers && numbers.length >= 2) {
      const a = parseFloat(numbers[0]);
      const b = parseFloat(numbers[1]);
      if (prompt.includes('+')) response = `${a + b}`;
      else if (prompt.includes('-') && prompt.indexOf('-') > prompt.indexOf(numbers[0])) response = `${a - b}`;
      else if (prompt.includes('*') || prompt.includes('\u00d7')) response = `${a * b}`;
      else if (prompt.includes('/') || prompt.includes('\u00f7')) response = b !== 0 ? `${a / b}` : 'undefined';
      else response = `${a + b}`;

      // Error probability scales with distance from optimal temperature
      const errorChance = (1 - tempFitness) * 0.6 + (1 - promptQuality) * 0.2;
      if (rng() < errorChance) {
        const noiseMag = (1 - tempFitness) * 20 + rng() * 5;
        const parsed = parseFloat(response);
        if (!isNaN(parsed)) {
          response = `${parsed + (rng() - 0.5) * noiseMag}`;
        }
      }
    }

    return { content: response, tokensUsed, latencyMs };
  }
}

// ── Anthropic Adapter ───────────────────────────────────────────

export class AnthropicAdapter implements LLMAdapter {
  private client: any;
  private fallbackClient: any;
  private model: string;

  constructor(apiKey?: string, model = 'claude-haiku-4-5-20251001') {
    this.model = model;
    this.initClient(apiKey);
  }

  private async initClient(apiKey?: string): Promise<void> {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = apiKey || process.env.ANTHROPIC_API_KEY
        ? new Anthropic({ apiKey })
        : null;

      // OpenRouter fallback key
      this.fallbackClient = process.env.OPENROUTER_API_KEY ?? null;
    } catch {
      console.warn('AnthropicAdapter: @anthropic-ai/sdk not available, falling back to MockAdapter behavior');
      this.client = null;
    }
  }

  private async callAnthropic(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    const start = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: config.maxTokens,
      temperature: Math.min(1, Math.max(0, config.temperature)),
      system: config.systemPrompt
        ? [{ type: 'text' as const, text: config.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
        : undefined,
      messages: config.messages
        ? [...config.messages, { role: 'user' as const, content: prompt }]
        : [{ role: 'user', content: prompt }],
    });

    const content = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    return {
      content,
      tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
      latencyMs: Date.now() - start,
    };
  }

  /** Model name mapping: Anthropic → OpenRouter */
  private get openRouterModel(): string {
    const map: Record<string, string> = {
      'claude-haiku-4-5-20251001': 'anthropic/claude-3.5-haiku',
      'claude-sonnet-4-5-20250514': 'anthropic/claude-sonnet-4',
    };
    return map[this.model] ?? `anthropic/${this.model}`;
  }

  private async callOpenRouter(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    const start = Date.now();
    const messages: Array<{ role: string; content: string }> = [];
    if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    if (config.messages) {
      for (const m of config.messages) {
        messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.fallbackClient}`,
      },
      body: JSON.stringify({
        model: this.openRouterModel,
        max_tokens: config.maxTokens,
        temperature: Math.min(1, Math.max(0, config.temperature)),
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};

    return {
      content,
      tokensUsed: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
      latencyMs: Date.now() - start,
    };
  }

  async execute(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    if (!this.client && !this.fallbackClient) {
      return new MockAdapter().execute(prompt, config);
    }

    const start = Date.now();
    try {
      if (this.client) {
        return await this.callAnthropic(prompt, config);
      }
    } catch (err) {
      console.warn('AnthropicAdapter: Anthropic call failed%s',
        this.fallbackClient ? ', trying OpenRouter fallback' : '',
        err instanceof Error ? err.message : String(err));
    }

    try {
      if (this.fallbackClient) {
        return await this.callOpenRouter(prompt, config);
      }
    } catch (err) {
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        tokensUsed: 0,
        latencyMs: Date.now() - start,
      };
    }

    return {
      content: 'Error: no API client available',
      tokensUsed: 0,
      latencyMs: Date.now() - start,
    };
  }
}

// ── OpenAI-Compatible Adapter ─────────────────────────────────
//
// Works with DeepSeek, Together, Groq, Ollama, or any OpenAI-compatible API.
//
// Usage:
//   new OpenAICompatibleAdapter({ provider: 'deepseek' })
//   new OpenAICompatibleAdapter({ baseUrl: 'http://localhost:11434/v1', model: 'llama3' })

export interface OpenAIAdapterConfig {
  /** Shortcut: 'deepseek' | 'together' | 'groq' | 'ollama'. Sets baseUrl, model, and env key. */
  provider?: 'deepseek' | 'together' | 'groq' | 'ollama';
  /** Base URL for the API (overrides provider default) */
  baseUrl?: string;
  /** Model name (overrides provider default) */
  model?: string;
  /** API key (overrides env var) */
  apiKey?: string;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string; envKey: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', envKey: 'DEEPSEEK_API_KEY' },
  together: { baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', envKey: 'TOGETHER_API_KEY' },
  groq:     { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', envKey: 'GROQ_API_KEY' },
  ollama:   { baseUrl: 'http://localhost:11434/v1', model: 'llama3', envKey: '' },
};

export class OpenAICompatibleAdapter implements LLMAdapter {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(config: OpenAIAdapterConfig = {}) {
    const providerName = config.provider ?? 'deepseek';
    const defaults = PROVIDER_DEFAULTS[providerName] ?? PROVIDER_DEFAULTS.deepseek;

    this.baseUrl = config.baseUrl ?? defaults.baseUrl;
    this.model = config.model ?? defaults.model;
    this.apiKey = config.apiKey
      ?? (defaults.envKey ? (process.env[defaults.envKey] ?? '') : '');
  }

  async execute(prompt: string, config: LLMConfig): Promise<LLMResponse> {
    if (!this.apiKey && !this.baseUrl.includes('localhost')) {
      return new MockAdapter().execute(prompt, config);
    }

    const start = Date.now();
    const messages: Array<{ role: string; content: string }> = [];

    if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    if (config.messages) {
      for (const m of config.messages) {
        messages.push({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          max_tokens: config.maxTokens,
          temperature: Math.min(1, Math.max(0, config.temperature)),
          messages,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content ?? '';
      const usage = data.usage ?? {};

      return {
        content,
        tokensUsed: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        tokensUsed: 0,
        latencyMs: Date.now() - start,
      };
    }
  }
}

// ── Utility ─────────────────────────────────────────────────────

import { hashString as hashStr } from '../core/utils.js';

function floatBits(f: number): number {
  return (f * 1e6) | 0;
}
