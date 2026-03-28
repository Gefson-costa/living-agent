import { describe, it, expect, vi } from 'vitest';
import {
  NoopObserver,
  RealLangfuseObserver,
  createLangfuseObserver,
} from '../src/observability/langfuse-observer.js';
import type { LLMAdapter, LLMConfig, EcologyCallbacks, EcologyStats, Strategy, TaskResult } from '../src/core/types.js';

// ── Helpers ──────────────────────────────────────────────────────

function mockAdapter(): LLMAdapter {
  return {
    execute: vi.fn().mockResolvedValue({
      content: 'test response',
      tokensUsed: 100,
      latencyMs: 50,
    }),
  };
}

function mockLangfuseClient() {
  const generationEnd = vi.fn();
  const spanEnd = vi.fn();
  const traceUpdate = vi.fn();

  const trace = {
    generation: vi.fn().mockReturnValue({ end: generationEnd }),
    span: vi.fn().mockReturnValue({ end: spanEnd }),
    update: traceUpdate,
  };

  const client = {
    trace: vi.fn().mockReturnValue(trace),
    flushAsync: vi.fn().mockResolvedValue(undefined),
  };

  return { client, trace, generationEnd, spanEnd, traceUpdate };
}

function fakeStrategy(id = 'strat_1'): Strategy {
  return {
    genome: {
      id,
      promptStyle: new Float32Array([0]),
      toolPreferences: new Float32Array([0]),
      temperature: 0.5,
      maxTokenBudget: 1000,
      reasoningDepth: 0.5,
      mutability: 1.0,
      learningRate: 0.01,
      lamarckianRate: 0.05,
      habitatPref: 0.5,
      fewShotCount: 0,
      promptSegments: [],
      skillRefs: [],
    },
    fitness: 1.0,
    age: 3,
    taskHistory: [],
    birthWeights: null,
    taskTypeMemory: new Map(),
  };
}

function fakeTaskResult(): TaskResult {
  return {
    taskId: 'task_1',
    strategyId: 'strat_1',
    score: 0.8,
    tokensUsed: 200,
    latencyMs: 100,
    response: 'answer',
    success: true,
    taskType: 'math',
  };
}

function fakeStats(): EcologyStats {
  return {
    cycle: 5,
    strategyCount: 10,
    avgFitness: 0.6,
    bestFitness: 0.9,
    maxAge: 10,
    noveltyArchiveSize: 20,
    mapElitesCoverage: 0.4,
    births: 15,
    deaths: 5,
  };
}

// ── NoopObserver ─────────────────────────────────────────────────

describe('NoopObserver', () => {
  it('enabled is false', () => {
    const noop = new NoopObserver();
    expect(noop.enabled).toBe(false);
  });

  it('wrapAdapter returns the same adapter', () => {
    const noop = new NoopObserver();
    const adapter = mockAdapter();
    expect(noop.wrapAdapter(adapter)).toBe(adapter);
  });

  it('ecologyCallbacks returns empty object when no existing', () => {
    const noop = new NoopObserver();
    expect(noop.ecologyCallbacks()).toEqual({});
  });

  it('ecologyCallbacks preserves existing callbacks', () => {
    const noop = new NoopObserver();
    const existing: EcologyCallbacks = {
      onCycleStart: vi.fn(),
      onCycleEnd: vi.fn(),
    };
    expect(noop.ecologyCallbacks(existing)).toBe(existing);
  });

  it('flush resolves immediately', async () => {
    const noop = new NoopObserver();
    await expect(noop.flush()).resolves.toBeUndefined();
  });
});

// ── RealLangfuseObserver ─────────────────────────────────────────

describe('RealLangfuseObserver', () => {
  it('enabled is true', () => {
    const { client } = mockLangfuseClient();
    const observer = new RealLangfuseObserver(client);
    expect(observer.enabled).toBe(true);
  });

  it('wrapped adapter creates generation with correct data', async () => {
    const { client, trace, generationEnd } = mockLangfuseClient();
    const observer = new RealLangfuseObserver(client);
    const adapter = mockAdapter();

    const wrapped = observer.wrapAdapter(adapter);
    const config: LLMConfig = {
      temperature: 0.7,
      maxTokens: 1000,
      systemPrompt: 'You are a solver',
      toolNames: [],
    };

    const result = await wrapped.execute('Solve this', config);

    expect(result.content).toBe('test response');
    expect(client.trace).toHaveBeenCalledWith({ name: 'llm-call' });
    expect(trace.generation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'execute',
        input: {
          prompt: 'Solve this',
          systemPrompt: 'You are a solver',
        },
        modelParameters: { temperature: 0.7, maxTokens: 1000 },
      }),
    );
    expect(generationEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        output: 'test response',
        usage: { totalTokens: 100 },
      }),
    );
  });

  it('ecology callbacks compose with existing ones', () => {
    const { client } = mockLangfuseClient();
    const observer = new RealLangfuseObserver(client);

    const existingStart = vi.fn();
    const existingEnd = vi.fn();
    const existingBirth = vi.fn();
    const existingDeath = vi.fn();
    const existingTask = vi.fn();

    const callbacks = observer.ecologyCallbacks({
      onCycleStart: existingStart,
      onCycleEnd: existingEnd,
      onBirth: existingBirth,
      onDeath: existingDeath,
      onTaskComplete: existingTask,
    });

    // Trigger cycle start
    callbacks.onCycleStart!(5);
    expect(existingStart).toHaveBeenCalledWith(5);
    expect(client.trace).toHaveBeenCalled();

    // Trigger birth
    const strategy = fakeStrategy();
    callbacks.onBirth!(strategy);
    expect(existingBirth).toHaveBeenCalledWith(strategy);

    // Trigger death
    callbacks.onDeath!(strategy);
    expect(existingDeath).toHaveBeenCalledWith(strategy);

    // Trigger task complete
    const result = fakeTaskResult();
    callbacks.onTaskComplete!(result);
    expect(existingTask).toHaveBeenCalledWith(result);

    // Trigger cycle end
    const stats = fakeStats();
    callbacks.onCycleEnd!(stats);
    expect(existingEnd).toHaveBeenCalledWith(stats);
  });

  it('flush delegates to langfuse.flushAsync', async () => {
    const { client } = mockLangfuseClient();
    const observer = new RealLangfuseObserver(client);
    await observer.flush();
    expect(client.flushAsync).toHaveBeenCalled();
  });
});

// ── Factory ──────────────────────────────────────────────────────

describe('createLangfuseObserver', () => {
  it('returns NoopObserver when env vars are absent', async () => {
    const prev = { ...process.env };
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    const observer = await createLangfuseObserver();
    expect(observer.enabled).toBe(false);
    expect(observer).toBeInstanceOf(NoopObserver);

    // Restore
    Object.assign(process.env, prev);
  });

  it('returns NoopObserver when only one key is set', async () => {
    const prev = { ...process.env };
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    delete process.env.LANGFUSE_SECRET_KEY;

    const observer = await createLangfuseObserver();
    expect(observer.enabled).toBe(false);

    // Restore
    delete process.env.LANGFUSE_PUBLIC_KEY;
    Object.assign(process.env, prev);
  });

  it('returns NoopObserver silently when langfuse not installed', async () => {
    const prev = { ...process.env };
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';

    const observer = await createLangfuseObserver();

    // langfuse is not installed in devDependencies, so it will fall back to noop
    expect(observer.enabled).toBe(false);

    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    Object.assign(process.env, prev);
  });
});
