// ================================================================
//  Baselines — Static and Random baselines for benchmark comparison
// ================================================================

import type {
  AgentConfig, Strategy, Task, TaskResult,
  LLMAdapter, TaskEvaluator, EcologyStats,
} from '../src/core/types.js';
import { MAX_TASK_HISTORY } from '../src/core/types.js';
import { createGenome } from '../src/evolution/genome.js';
import { buildSystemPrompt } from '../src/llm/adapter.js';
import { updateTaskTypeMemory, decayTaskTypeMemory } from '../src/learning/task-memory.js';
import type { createSeededRng } from './harness.js';

// ── Static Baseline ─────────────────────────────────────────────
//
// A population of identical "optimal" strategies that never evolve.
// Same structure as Ecology (N strategies, 1 task each per cycle)
// but with hand-tuned parameters and no evolution/mutation/crossover.

export class StaticBaseline {
  private strategies: Strategy[] = [];
  private llm: LLMAdapter;
  private evaluator: TaskEvaluator;
  private config: AgentConfig;
  private cycle_ = 0;

  constructor(config: AgentConfig, llm: LLMAdapter, evaluator: TaskEvaluator) {
    this.config = config;
    this.llm = llm;
    this.evaluator = evaluator;

    // Create a population of identical clones with "optimal" parameters
    for (let i = 0; i < config.strategyCount; i++) {
      const genome = createGenome(config);
      genome.temperature = 0.5;        // MockAdapter sweet spot
      genome.reasoningDepth = 0.8;     // triggers step-by-step prompt
      genome.maxTokenBudget = 2000;    // moderate cost
      genome.habitatPref = 0.5;        // generalist

      this.strategies.push({
        genome,
        fitness: 0,
        age: 0,
        taskHistory: [],
        birthWeights: null,
        taskTypeMemory: new Map(),
      });
    }
  }

  async runCycle(): Promise<EcologyStats> {
    this.cycle_++;
    const tasks = this.evaluator.generateTasks(
      Math.max(this.config.taskBatchSize, this.strategies.length),
    );

    // Each strategy gets one task (same as ecology), no habitat matching
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.strategies.length && i < tasks.length; i++) {
      const strategy = this.strategies[i];
      const task = tasks[i];
      promises.push(
        this.executeTask(strategy, task).then(result => {
          this.reward(strategy, result);
        }),
      );
    }
    await Promise.all(promises);

    for (const s of this.strategies) {
      s.age++;
      decayTaskTypeMemory(s);
    }

    return this.getStats();
  }

  async run(cycles: number): Promise<EcologyStats[]> {
    const allStats: EcologyStats[] = [];
    for (let i = 0; i < cycles; i++) {
      allStats.push(await this.runCycle());
    }
    return allStats;
  }

  private async executeTask(strategy: Strategy, task: Task): Promise<TaskResult> {
    const systemPrompt = buildSystemPrompt(
      this.config.systemPromptTemplate,
      strategy.genome,
      this.config.toolNames,
      strategy.taskTypeMemory,
    );
    const llmConfig = {
      temperature: strategy.genome.temperature,
      maxTokens: strategy.genome.maxTokenBudget,
      systemPrompt,
      toolNames: this.config.toolNames,
    };

    const response = await this.llm.execute(task.prompt, llmConfig);
    const score = this.evaluator.score(task, response.content);

    return {
      taskId: task.id,
      strategyId: strategy.genome.id,
      score,
      tokensUsed: response.tokensUsed,
      latencyMs: response.latencyMs,
      response: response.content,
      success: score >= 0.5,
      taskType: task.type,
    };
  }

  private reward(strategy: Strategy, result: TaskResult): void {
    const baseReward = (result.score - 0.35) * 4;
    const tokenCost = strategy.genome.maxTokenBudget / 4000 * 0.5;
    strategy.fitness += baseReward - tokenCost;

    strategy.taskHistory.push(result);
    if (strategy.taskHistory.length > MAX_TASK_HISTORY) {
      strategy.taskHistory.shift();
    }

    updateTaskTypeMemory(strategy, result.taskType, result.score);
  }

  getStats(): EcologyStats {
    let totalFitness = 0;
    let bestFitness = -Infinity;
    let maxAge = 0;

    for (const s of this.strategies) {
      totalFitness += s.fitness;
      if (s.fitness > bestFitness) bestFitness = s.fitness;
      if (s.age > maxAge) maxAge = s.age;
    }

    return {
      cycle: this.cycle_,
      strategyCount: this.strategies.length,
      avgFitness: this.strategies.length > 0 ? totalFitness / this.strategies.length : 0,
      bestFitness: this.strategies.length > 0 ? bestFitness : 0,
      maxAge,
      noveltyArchiveSize: 0,
      mapElitesCoverage: 0,
      births: this.strategies.length,
      deaths: 0,
    };
  }
}

// ── Random Baseline ─────────────────────────────────────────────
//
// Normal population of strategies but with random task assignment
// and NO evolution (no crossover, mutation, culling, or rescue).
// Isolates the value of the evolutionary mechanism.

export class RandomBaseline {
  private strategies: Strategy[] = [];
  private llm: LLMAdapter;
  private evaluator: TaskEvaluator;
  private config: AgentConfig;
  private cycle_ = 0;
  private rng: () => number;

  constructor(
    config: AgentConfig,
    llm: LLMAdapter,
    evaluator: TaskEvaluator,
    rng: () => number = Math.random,
  ) {
    this.config = config;
    this.llm = llm;
    this.evaluator = evaluator;
    this.rng = rng;

    // Spawn initial population with random genomes
    for (let i = 0; i < config.strategyCount; i++) {
      const genome = createGenome(config, rng);
      this.strategies.push({
        genome,
        fitness: 0,
        age: 0,
        taskHistory: [],
        birthWeights: null,
        taskTypeMemory: new Map(),
      });
    }
  }

  async runCycle(): Promise<EcologyStats> {
    this.cycle_++;
    const tasks = this.evaluator.generateTasks(
      Math.max(this.config.taskBatchSize, this.strategies.length),
    );

    // Random assignment: shuffle tasks and assign sequentially
    const shuffled = [...tasks].sort(() => this.rng() - 0.5);
    const promises: Promise<void>[] = [];

    for (let i = 0; i < this.strategies.length && i < shuffled.length; i++) {
      const strategy = this.strategies[i];
      const task = shuffled[i];
      promises.push(
        this.executeTask(strategy, task).then(result => {
          this.reward(strategy, result);
        }),
      );
    }
    await Promise.all(promises);

    for (const s of this.strategies) {
      s.age++;
      decayTaskTypeMemory(s);
    }

    return this.getStats();
  }

  async run(cycles: number): Promise<EcologyStats[]> {
    const allStats: EcologyStats[] = [];
    for (let i = 0; i < cycles; i++) {
      allStats.push(await this.runCycle());
    }
    return allStats;
  }

  private async executeTask(strategy: Strategy, task: Task): Promise<TaskResult> {
    const systemPrompt = buildSystemPrompt(
      this.config.systemPromptTemplate,
      strategy.genome,
      this.config.toolNames,
      strategy.taskTypeMemory,
    );
    const llmConfig = {
      temperature: strategy.genome.temperature,
      maxTokens: strategy.genome.maxTokenBudget,
      systemPrompt,
      toolNames: this.config.toolNames,
    };

    const response = await this.llm.execute(task.prompt, llmConfig);
    const score = this.evaluator.score(task, response.content);

    return {
      taskId: task.id,
      strategyId: strategy.genome.id,
      score,
      tokensUsed: response.tokensUsed,
      latencyMs: response.latencyMs,
      response: response.content,
      success: score >= 0.5,
      taskType: task.type,
    };
  }

  private reward(strategy: Strategy, result: TaskResult): void {
    const baseReward = (result.score - 0.35) * 4;
    const tokenCost = strategy.genome.maxTokenBudget / 4000 * 0.5;
    strategy.fitness += baseReward - tokenCost;

    strategy.taskHistory.push(result);
    if (strategy.taskHistory.length > MAX_TASK_HISTORY) {
      strategy.taskHistory.shift();
    }

    updateTaskTypeMemory(strategy, result.taskType, result.score);
  }

  getStats(): EcologyStats {
    let totalFitness = 0;
    let bestFitness = -Infinity;
    let maxAge = 0;

    for (const s of this.strategies) {
      totalFitness += s.fitness;
      if (s.fitness > bestFitness) bestFitness = s.fitness;
      if (s.age > maxAge) maxAge = s.age;
    }

    return {
      cycle: this.cycle_,
      strategyCount: this.strategies.length,
      avgFitness: this.strategies.length > 0 ? totalFitness / this.strategies.length : 0,
      bestFitness: this.strategies.length > 0 ? bestFitness : 0,
      maxAge,
      noveltyArchiveSize: 0,
      mapElitesCoverage: 0,
      births: this.config.strategyCount,
      deaths: 0,
    };
  }

  getStrategies(): readonly Strategy[] {
    return this.strategies;
  }
}
