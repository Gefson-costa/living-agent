// ================================================================
//  Langfuse Observer — Optional LLM observability
//
//  Zero overhead when disabled (no Langfuse package, no env vars).
//  Wraps LLMAdapter calls and ecology lifecycle events as traces.
// ================================================================

import type { LLMAdapter, LLMConfig, LLMResponse, EcologyCallbacks, Strategy, TaskResult, EcologyStats } from '../core/types.js';

// ── Public Interface ─────────────────────────────────────────────

export interface LangfuseObserver {
  readonly enabled: boolean;
  wrapAdapter(adapter: LLMAdapter): LLMAdapter;
  ecologyCallbacks(existing?: EcologyCallbacks): EcologyCallbacks;
  flush(): Promise<void>;
}

// ── Noop Implementation ──────────────────────────────────────────

export class NoopObserver implements LangfuseObserver {
  readonly enabled = false;

  wrapAdapter(adapter: LLMAdapter): LLMAdapter {
    return adapter;
  }

  ecologyCallbacks(existing?: EcologyCallbacks): EcologyCallbacks {
    return existing ?? {};
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

// ── Real Implementation ──────────────────────────────────────────

interface LangfuseClient {
  trace(params: Record<string, unknown>): LangfuseTrace;
  flushAsync(): Promise<unknown>;
}

interface LangfuseTrace {
  generation(params: Record<string, unknown>): LangfuseGeneration;
  span(params: Record<string, unknown>): LangfuseSpan;
  update(params: Record<string, unknown>): void;
}

interface LangfuseGeneration {
  end(params: Record<string, unknown>): void;
}

interface LangfuseSpan {
  end(params?: Record<string, unknown>): void;
}

export class RealLangfuseObserver implements LangfuseObserver {
  readonly enabled = true;
  private client: LangfuseClient;

  constructor(client: LangfuseClient) {
    this.client = client;
  }

  wrapAdapter(adapter: LLMAdapter): LLMAdapter {
    const client = this.client;
    return {
      async execute(prompt: string, config: LLMConfig): Promise<LLMResponse> {
        const trace = client.trace({ name: 'llm-call' });
        const generation = trace.generation({
          name: 'execute',
          input: {
            prompt: prompt.slice(0, 500),
            systemPrompt: config.systemPrompt.slice(0, 300),
          },
          model: `temp=${config.temperature}`,
          modelParameters: {
            temperature: config.temperature,
            maxTokens: config.maxTokens,
          },
        });

        const start = performance.now();
        const response = await adapter.execute(prompt, config);
        const latencyMs = performance.now() - start;

        generation.end({
          output: response.content.slice(0, 500),
          usage: { totalTokens: response.tokensUsed },
          metadata: { latencyMs },
        });

        return response;
      },
    };
  }

  ecologyCallbacks(existing?: EcologyCallbacks): EcologyCallbacks {
    const client = this.client;
    let currentTrace: LangfuseTrace | null = null;

    return {
      onCycleStart: (cycle: number) => {
        currentTrace = client.trace({ name: `cycle-${cycle}`, metadata: { cycle } });
        existing?.onCycleStart?.(cycle);
      },
      onCycleEnd: (stats: EcologyStats) => {
        currentTrace?.update({
          metadata: {
            avgFitness: stats.avgFitness,
            bestFitness: stats.bestFitness,
            strategyCount: stats.strategyCount,
            births: stats.births,
            deaths: stats.deaths,
          },
        });
        currentTrace = null;
        existing?.onCycleEnd?.(stats);
      },
      onBirth: (strategy: Strategy) => {
        currentTrace?.span({
          name: 'birth',
          metadata: { strategyId: strategy.genome.id },
        }).end();
        existing?.onBirth?.(strategy);
      },
      onDeath: (strategy: Strategy) => {
        currentTrace?.span({
          name: 'death',
          metadata: { strategyId: strategy.genome.id, fitness: strategy.fitness },
        }).end();
        existing?.onDeath?.(strategy);
      },
      onTaskComplete: (result: TaskResult) => {
        currentTrace?.span({
          name: 'task-complete',
          metadata: {
            score: result.score,
            tokensUsed: result.tokensUsed,
            taskType: result.taskType,
          },
        }).end();
        existing?.onTaskComplete?.(result);
      },
    };
  }

  async flush(): Promise<void> {
    await this.client.flushAsync();
  }
}

// ── Factory ──────────────────────────────────────────────────────

export async function createLangfuseObserver(): Promise<LangfuseObserver> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return new NoopObserver();
  }

  try {
    // Dynamic import — langfuse is an optional peer dependency
    const mod: Record<string, unknown> = await (Function('m', 'return import(m)')('langfuse') as Promise<Record<string, unknown>>);
    const defaultExport = mod.default as Record<string, unknown> | undefined;
    const Langfuse = (mod.Langfuse ?? defaultExport?.Langfuse ?? defaultExport) as new (opts: Record<string, unknown>) => LangfuseClient;
    const client = new Langfuse({ publicKey, secretKey }) as LangfuseClient;
    return new RealLangfuseObserver(client);
  } catch {
    console.warn('[living-agent] langfuse package not installed — observability disabled');
    return new NoopObserver();
  }
}
