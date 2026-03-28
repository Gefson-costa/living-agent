// ================================================================
//  Ecology — Main Strategy Evolution Orchestrator
//
//  One agent, multiple internal strategies competing on tasks.
//  Lifecycle: spawn → assign → execute → reward → evolve → cull → rescue
// ================================================================

import type {
  AgentConfig, Strategy, Task, TaskResult,
  LLMAdapter, TaskEvaluator, EcologyStats, EcologyCallbacks,
} from '../core/types.js';
import { MAX_TASK_HISTORY } from '../core/types.js';
import { createGenome, mutateGenome } from './genome.js';
import { NoveltyArchive } from './novelty.js';
import { MapElites } from './map-elites.js';
import {
  applyFitnessDecay,
  selectParents,
  breedOffspring,
  createOffspringStrategy,
  computeNoveltySeed,
  rescueFromElites,
  applyTaskMemoryDecay,
} from './evolution-engine.js';
import { buildSystemPrompt } from '../llm/adapter.js';
import { updateTaskTypeMemory } from '../learning/task-memory.js';
import { rewardModulatedUpdate, decayTowardBirth, lamarckianTransfer } from '../learning/reward-learning.js';
import { hashString } from '../core/utils.js';
import {
  HASH_NORMALIZER, BASE_REWARD_CENTER, BASE_REWARD_SCALE,
  TOKEN_COST_NORMALIZER, TOKEN_COST_WEIGHT,
  HABITAT_MATCH_THRESHOLD, HABITAT_BONUS, EXPERTISE_BONUS_WEIGHT,
  BREED_TOP_FRACTION, BIRTH_TARGET_FRACTION, MAP_ELITES_CHAMPION_CHANCE,
  NOVELTY_SEED_ECOLOGY, MIN_CULL_AGE, MAX_RESCUE_COUNT, MIN_RESCUE_CELLS,
  ELO_DRAW_THRESHOLD,
} from '../core/constants.js';
import { EloTracker } from './elo-tracker.js';

export class Ecology {
  readonly config: AgentConfig;
  private strategies: Strategy[] = [];
  private llm: LLMAdapter;
  private evaluator: TaskEvaluator;
  private noveltyArchive = new NoveltyArchive();
  private mapElites = new MapElites();
  private cycle_ = 0;
  private totalBirths = 0;
  private totalDeaths = 0;
  private eloTracker = new EloTracker();
  private callbacks: EcologyCallbacks;

  constructor(
    config: AgentConfig,
    llm: LLMAdapter,
    evaluator: TaskEvaluator,
    callbacks: EcologyCallbacks = {},
  ) {
    this.config = config;
    this.llm = llm;
    this.evaluator = evaluator;
    this.callbacks = callbacks;

    this.spawn(config.strategyCount);
  }

  // ── Spawn ───────────────────────────────────────────────────────

  private spawn(count: number): void {
    for (let i = 0; i < count; i++) {
      const genome = createGenome(this.config);
      const strategy = createOffspringStrategy({ genome });
      this.strategies.push(strategy);
      this.totalBirths++;
      this.callbacks.onBirth?.(strategy);
    }
  }

  // ── Assign Tasks ──────────────────────────────────────────────

  private assignTasks(tasks: Task[]): Map<Strategy, Task> {
    const assignments = new Map<Strategy, Task>();
    const availableTasks = [...tasks];

    for (const strategy of this.strategies) {
      if (availableTasks.length === 0) break;

      // Habitat matching: prefer tasks whose type matches strategy's habitatPref
      let bestIdx = 0;
      let bestMatch = -1;

      for (let i = 0; i < availableTasks.length; i++) {
        const task = availableTasks[i];
        const taskHash = hashString(task.type) / HASH_NORMALIZER;
        const match = 1 - Math.abs(strategy.genome.habitatPref - taskHash);

        // Task-type expertise bonus
        const expertise = strategy.taskTypeMemory.get(task.type) ?? 0;
        const expertiseBonus = expertise * EXPERTISE_BONUS_WEIGHT;

        if (match + expertiseBonus > bestMatch) {
          bestMatch = match + expertiseBonus;
          bestIdx = i;
        }
      }

      assignments.set(strategy, availableTasks[bestIdx]);
      availableTasks.splice(bestIdx, 1);
    }

    return assignments;
  }

  // ── Execute ───────────────────────────────────────────────────

  private async executeTask(strategy: Strategy, task: Task): Promise<TaskResult> {
    const systemPrompt = buildSystemPrompt(
      this.config.systemPromptTemplate,
      strategy.genome,
      this.config.toolNames,
      strategy.taskTypeMemory,
    );
    const config = {
      temperature: strategy.genome.temperature,
      maxTokens: strategy.genome.maxTokenBudget,
      systemPrompt,
      toolNames: this.config.toolNames,
    };

    const response = await this.llm.execute(task.prompt, config);
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

  // ── Reward ────────────────────────────────────────────────────

  private reward(strategy: Strategy, result: TaskResult): void {
    const prevFitness = strategy.fitness;

    // Base reward: task score centered around zero
    const baseReward = (result.score - BASE_REWARD_CENTER) * BASE_REWARD_SCALE;

    // Token efficiency: expensive configs pay more
    const tokenCost = strategy.genome.maxTokenBudget / TOKEN_COST_NORMALIZER * TOKEN_COST_WEIGHT;

    // Habitat bonus: specialists get rewarded in their niche
    const taskHash = hashString(result.taskType) / HASH_NORMALIZER;
    const habitatMatch = 1 - Math.abs(strategy.genome.habitatPref - taskHash);
    const habitatBonus = habitatMatch > HABITAT_MATCH_THRESHOLD ? HABITAT_BONUS : 0;

    strategy.fitness += baseReward + habitatBonus - tokenCost;

    // Add to task history (ring buffer)
    strategy.taskHistory.push(result);
    if (strategy.taskHistory.length > MAX_TASK_HISTORY) {
      strategy.taskHistory.shift();
    }

    // Within-lifetime learning: nudge weights based on task performance
    rewardModulatedUpdate(strategy, prevFitness);

    // Update task-type memory
    if (this.config.enableTaskMemory !== false) {
      updateTaskTypeMemory(strategy, result.taskType, result.score);
    }

    this.callbacks.onTaskComplete?.(result);
  }

  // ── Evolve ────────────────────────────────────────────────────

  private evolve(): Strategy[] {
    const births: Strategy[] = [];

    // CycleQD: rotate MAP-Elites dimensions each cycle
    if (this.config.enableCycleQD !== false) {
      this.mapElites.advanceCycle();
    }

    // Sort strategies by fitness (descending)
    const ranked = [...this.strategies].sort((a, b) => b.fitness - a.fitness);
    if (ranked.length < 2) return births;

    // Top strategies produce offspring
    const eliteCount = Math.max(1, Math.floor(ranked.length * this.config.elitismRate));
    const topStrategies = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * BREED_TOP_FRACTION)));

    // Decay non-elite strategies toward birth weights (prevents runaway drift)
    for (let i = eliteCount; i < ranked.length; i++) {
      decayTowardBirth(ranked[i]);
    }

    // Target: maintain strategy count near config.strategyCount
    const needed = Math.max(0, this.config.strategyCount - this.strategies.length);
    const birthTarget = Math.max(1, Math.min(needed + 2, Math.floor(this.config.strategyCount * BIRTH_TARGET_FRACTION)));

    for (let b = 0; b < birthTarget && topStrategies.length >= 2; b++) {
      const { parent1, parent2 } = selectParents(topStrategies, this.eloTracker);

      // Active MAP-Elites: 20% chance to use a champion as second parent
      let parent2Genome = parent2.genome;
      if (Math.random() < MAP_ELITES_CHAMPION_CHANCE && this.mapElites.filledCells >= 2) {
        const champion = this.mapElites.getRandomChampion();
        if (champion) parent2Genome = champion;
      }

      const childGenome = this.config.enableCrossover !== false
        ? breedOffspring(parent1.genome, parent2Genome, this.config.mutationRate, this.config, parent1.fitness, parent2.fitness)
        : mutateGenome(parent1.genome, this.config.mutationRate, this.config);

      // Lamarckian transfer: pass learned weight deltas from best parent
      lamarckianTransfer(parent1, childGenome);

      // Novelty bonus — seed from child genome (not parent)
      const noveltyWeight = this.config.enableNoveltyBonus !== false ? this.config.noveltyWeight : 0;
      const noveltySeed = computeNoveltySeed(childGenome, this.noveltyArchive, noveltyWeight, NOVELTY_SEED_ECOLOGY);

      const child = createOffspringStrategy({ genome: childGenome, noveltySeed });
      this.noveltyArchive.add(NoveltyArchive.describe(child));
      births.push(child);
      this.totalBirths++;
      this.callbacks.onBirth?.(child);

      // Archive parent in MAP-Elites
      const parentDesc = NoveltyArchive.describe(parent1);
      this.mapElites.insert(parent1.genome, parent1.fitness, parentDesc);
    }

    return births;
  }

  // ── Cull ──────────────────────────────────────────────────────

  private cull(): void {
    for (const strategy of this.strategies) {
      strategy.age++;
    }

    this.strategies = this.strategies.filter(s => {
      if (s.fitness <= this.config.cullThreshold && s.age > MIN_CULL_AGE) {
        this.totalDeaths++;
        this.eloTracker.remove(s.genome.id);
        this.callbacks.onDeath?.(s);
        return false;
      }
      return true;
    });
  }

  // ── MAP-Elites Rescue ─────────────────────────────────────────

  private rescue(): void {
    if (this.config.enableMapElites === false) return;
    const minPop = this.config.strategyCount * this.config.rescueThreshold;
    if (this.strategies.length >= minPop) return;
    if (this.mapElites.filledCells < MIN_RESCUE_CELLS) return;

    const rescueCount = Math.min(MAX_RESCUE_COUNT, Math.max(1, ((minPop - this.strategies.length) / 2) | 0));
    for (let r = 0; r < rescueCount; r++) {
      const strategy = rescueFromElites({
        mapElites: this.mapElites,
        mutationRate: this.config.mutationRate,
        config: this.config,
      });
      if (!strategy) break;

      this.strategies.push(strategy);
      this.totalBirths++;
      this.callbacks.onBirth?.(strategy);
    }
  }

  // ── Main Cycle ────────────────────────────────────────────────

  async runCycle(): Promise<EcologyStats> {
    this.cycle_++;
    this.callbacks.onCycleStart?.(this.cycle_);

    // 0. Fitness decay — force strategies to prove value each cycle
    if (this.config.enableFitnessDecay !== false) {
      applyFitnessDecay(this.strategies);
    }

    // 1. Generate tasks
    const batchSize = Math.max(this.config.taskBatchSize, this.strategies.length);
    const tasks = this.evaluator.generateTasks(batchSize);

    // 2. Assign tasks to strategies (habitat matching)
    const assignments = this.assignTasks(tasks);

    // 3. Execute tasks in parallel
    const results = new Map<Strategy, TaskResult>();
    const promises: Promise<void>[] = [];
    for (const [strategy, task] of assignments) {
      promises.push(
        this.executeTask(strategy, task).then(result => {
          this.reward(strategy, result);
          results.set(strategy, result);
        }),
      );
    }
    await Promise.all(promises);

    // 3b. Pairwise Elo updates for strategies that did the same task type
    if (this.config.enableElo !== false) {
      const byType = new Map<string, { strategy: Strategy; result: TaskResult }[]>();
      for (const [strategy, result] of results) {
        const group = byType.get(result.taskType) ?? [];
        group.push({ strategy, result });
        byType.set(result.taskType, group);
      }
      for (const group of byType.values()) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i], b = group[j];
            const diff = Math.abs(a.result.score - b.result.score);
            if (diff < ELO_DRAW_THRESHOLD) {
              this.eloTracker.recordMatch(a.strategy.genome.id, b.strategy.genome.id, true);
            } else if (a.result.score > b.result.score) {
              this.eloTracker.recordMatch(a.strategy.genome.id, b.strategy.genome.id);
            } else {
              this.eloTracker.recordMatch(b.strategy.genome.id, a.strategy.genome.id);
            }
          }
        }
      }
    }

    // 4. Decay task-type memory
    if (this.config.enableTaskMemory !== false) {
      applyTaskMemoryDecay(this.strategies);
    }

    // 5. Evolve: produce new strategies from top performers
    const births = this.evolve();
    this.strategies.push(...births);

    // 6. Cull low-fitness strategies
    this.cull();

    // 7. MAP-Elites rescue if population crashed
    this.rescue();

    // Compute and return stats
    const stats = this.getStats();
    this.callbacks.onCycleEnd?.(stats);
    return stats;
  }

  /** Run multiple cycles */
  async run(cycles: number): Promise<EcologyStats[]> {
    const allStats: EcologyStats[] = [];
    for (let i = 0; i < cycles; i++) {
      allStats.push(await this.runCycle());
    }
    return allStats;
  }

  // ── Stats ─────────────────────────────────────────────────────

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
      noveltyArchiveSize: this.noveltyArchive.size,
      mapElitesCoverage: this.mapElites.coverageRatio,
      births: this.totalBirths,
      deaths: this.totalDeaths,
      eloRatings: this.eloTracker.getAllRatings(),
      mapElitesAxes: this.mapElites.currentAxes,
    };
  }

  /** Get all strategies */
  getStrategies(): readonly Strategy[] {
    return this.strategies;
  }

  /** Get the best performing strategy */
  getBestStrategy(): Strategy | null {
    let best: Strategy | null = null;
    let bestFitness = -Infinity;
    for (const s of this.strategies) {
      if (s.fitness > bestFitness) {
        bestFitness = s.fitness;
        best = s;
      }
    }
    return best;
  }

  /** Kill a fraction of the population (for testing crash rescue) */
  killFraction(fraction: number): number {
    const toKill = Math.floor(this.strategies.length * fraction);
    let killed = 0;
    const sorted = [...this.strategies].sort((a, b) => a.fitness - b.fitness);
    for (let i = 0; i < toKill && i < sorted.length; i++) {
      sorted[i].fitness = -Infinity; // mark for removal
      killed++;
      this.totalDeaths++;
      this.callbacks.onDeath?.(sorted[i]);
    }
    this.strategies = this.strategies.filter(s => s.fitness !== -Infinity);
    return killed;
  }

  /** Get the novelty archive (for testing) */
  getNoveltyArchive(): NoveltyArchive {
    return this.noveltyArchive;
  }

  /** Get the MAP-Elites grid (for testing) */
  getMapElites(): MapElites {
    return this.mapElites;
  }

  /** Get the Elo tracker (for testing) */
  getEloTracker(): EloTracker {
    return this.eloTracker;
  }
}
