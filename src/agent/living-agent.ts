// ================================================================
//  Living Agent — Interactive agent with evolving strategies
//
//  Integrates all modules: genome evolution, novelty search,
//  MAP-Elites, skill library, hybrid fitness, reward learning,
//  and consolidation into a single interactive agent.
// ================================================================

import type {
  Strategy, AgentConfig, LLMAdapter, StorageAdapter,
  Task, TaskResult, FitnessSignal, FitnessWeights, MapElitesCell, Skill, ChatMessage,
  EngagementMetrics,
} from '../core/types.js';
import { MAX_TASK_HISTORY } from '../core/types.js';

import { createGenome } from '../evolution/genome.js';
import { NoveltyArchive } from '../evolution/novelty.js';
import { MapElites } from '../evolution/map-elites.js';
import {
  applyFitnessDecay,
  applyTaskMemoryDecay,
  createOffspringStrategy,
  rescueFromElites,
} from '../evolution/evolution-engine.js';

import { strategyToLLMConfig } from '../llm/prompt-builder.js';
import { selfEvaluate } from '../fitness/self-eval.js';
import { computeLocalEval, shouldCallLLMEval, DEFAULT_LLM_BUDGET } from '../fitness/local-eval.js';
import type { LLMBudget } from '../fitness/local-eval.js';
import { ResponseHistory } from '../embeddings/response-history.js';
import { EmbeddingRouter } from '../embeddings/embedding-router.js';
import { createEmbedder } from '../embeddings/embedder.js';
import { computeHybridFitness, calibrateWeights } from '../fitness/hybrid-fitness.js';
import { buildAutoMetrics, computeEngagementScore } from '../fitness/implicit-fitness.js';

import { snapshotBirthWeights, rewardModulatedUpdate } from '../learning/reward-learning.js';
import { updateTaskTypeMemory } from '../learning/task-memory.js';
import { consolidate } from '../learning/consolidation.js';

import { SkillLibrary } from '../skills/skill-library.js';
import { SkillExtractor } from '../skills/skill-extractor.js';
import { PrincipleDistiller } from '../skills/principle-distiller.js';

import { classifyTask } from './task-classifier.js';
import { selectStrategy } from './strategy-selector.js';
import { ClassifierMemory } from './classifier-memory.js';

import type { TaskType, Interaction, LivingAgentConfig, AgentStatus } from './interaction.js';
import { DEFAULT_LIVING_AGENT_CONFIG } from './interaction.js';
import type { StrategyGenome } from '../core/types.js';
import type { PatchResult } from '../self-coding/types.js';

import { BudgetTracker } from '../safety/budget-cap.js';
import { AuditLog } from '../safety/audit-log.js';
import { PopulationRollback } from '../safety/rollback.js';

// Escada 3: Self-Modification
import { ToolSynthesizer } from '../self-coding/tool-synthesis.js';
import { ArchitectureEvolution, CONFIG_BOUNDS } from '../self-coding/arch-evolution.js';

export class LivingAgent {
  private config: LivingAgentConfig;
  private agentConfig: AgentConfig;
  private llm: LLMAdapter;
  private store: StorageAdapter;

  private strategies: Strategy[] = [];
  private noveltyArchive = new NoveltyArchive();
  private mapElites = new MapElites();
  private skillLibrary: SkillLibrary;
  private skillExtractor: SkillExtractor;
  private principleDistiller: PrincipleDistiller;

  private interactions: Interaction[] = [];
  private interactionCounter = 0;
  private consolidationCount = 0;
  private taskTypeDistribution: Record<string, number> = {};

  private conversationHistory: ChatMessage[] = [];
  private fitnessWeights: FitnessWeights | null = null;
  private classifierMemory = new ClassifierMemory();

  // Tracks the last interaction so we can apply late feedback
  private pendingFeedback: Interaction | null = null;
  private sessionTurnCount = 0;
  private noReplyTimer: ReturnType<typeof setTimeout> | null = null;

  // Safety (Escada 2.5)
  private budgetTracker: BudgetTracker;
  private auditLog: AuditLog;
  private rollback: PopulationRollback;

  // Response Fingerprinting (Point 2 — vector cognition)
  private responseHistory!: ResponseHistory; // initialized in init()
  private embeddingRouter!: EmbeddingRouter; // initialized in init()

  // Escada 3: Self-Modification
  private toolSynthesizer?: ToolSynthesizer;
  private toolsSynthesized = new Set<string>();
  private archEvolution?: ArchitectureEvolution;

  constructor(
    llm: LLMAdapter,
    store: StorageAdapter,
    config: Partial<LivingAgentConfig> = {},
  ) {
    this.config = { ...DEFAULT_LIVING_AGENT_CONFIG, ...config };
    this.llm = llm;
    this.store = store;
    this.skillLibrary = new SkillLibrary(store);  // embedder set in init()
    this.skillExtractor = new SkillExtractor(this.skillLibrary, llm, {
      scoreThreshold: this.config.skillExtractionThreshold,
    });
    this.principleDistiller = new PrincipleDistiller(this.skillLibrary, store, llm, {
      minExperiences: this.config.distillMinExperiences,
      llmDistillation: this.config.distillWithLLM,
    });

    // Build an AgentConfig compatible with existing modules
    this.agentConfig = {
      strategyCount: this.config.strategyCount,
      mutationRate: this.config.mutationRate,
      promptStyleDim: this.config.promptStyleDim,
      toolCount: this.config.toolCount,
      noveltyWeight: 0.8,
      elitismRate: 0.1,
      cullThreshold: -2,
      taskBatchSize: 1,
      rescueThreshold: 0.15,
      toolNames: this.config.toolNames,
      systemPromptTemplate: this.config.systemPromptTemplate,
    };

    // Safety (Escada 2.5)
    this.budgetTracker = new BudgetTracker(this.config.safety?.budget);
    this.auditLog = new AuditLog();
    this.rollback = new PopulationRollback(this.config.safety?.snapshotRetention ?? 20);

    // Escada 3: Self-Modification
    if (this.config.selfCoding?.enabled) {
      this.toolSynthesizer = new ToolSynthesizer(this.llm, this.config.selfCoding.projectRoot);
      this.archEvolution = new ArchitectureEvolution(this.llm);
    }
  }

  /** Initialize the strategy population. Must call before chat(). */
  async init(): Promise<void> {
    // Initialize embedder — tries Ollama first (real semantic embeddings),
    // falls back to SimpleEmbedder if Ollama isn't running.
    // This allows using Ollama just for embeddings while the main LLM
    // is Claude/DeepSeek/etc via API.
    const embedder = await createEmbedder(this.config.embeddingOllama);
    this.responseHistory = new ResponseHistory(embedder);
    this.embeddingRouter = new EmbeddingRouter(embedder);

    // Vector Memory: give the skill library the same embedder for semantic retrieval
    this.skillLibrary.setEmbedder(embedder);
    await this.skillLibrary.initEmbeddings();

    // Try to load persisted strategies
    const loaded = await this.store.loadStrategies();
    if (loaded.length > 0) {
      this.strategies = loaded;
      // Restore birth weight snapshots for loaded strategies
      for (const strategy of this.strategies) {
        if (!strategy.birthWeights) {
          snapshotBirthWeights(strategy);
        }
      }
    } else {
      // Bootstrap new population
      this.strategies = [];
      for (let i = 0; i < this.config.strategyCount; i++) {
        const genome = createGenome(this.agentConfig);
        this.strategies.push(createOffspringStrategy({ genome }));
      }
    }

    // Try to load MAP-Elites grid
    const grid = await this.store.loadGrid();
    if (grid) {
      for (const cell of grid) {
        const behavior = NoveltyArchive.describe({
          genome: cell.genome,
          fitness: cell.fitness,
          age: 0,
          taskHistory: [],
          birthWeights: null,
          taskTypeMemory: new Map(),
        });
        this.mapElites.insert(cell.genome, cell.fitness, behavior);
      }
    }

    // Load agent metadata
    await this.loadMetadata();
  }

  /** Process a user message and return a response */
  async chat(userMessage: string): Promise<string> {
    // Finalize the previous interaction with auto-engagement
    if (this.pendingFeedback) {
      await this.finalizePendingInteraction(userMessage, Date.now());
    }
    this.sessionTurnCount++;

    // 1. Classify task (with adaptive memory)
    const taskType = classifyTask(userMessage, this.classifierMemory);
    this.trackTaskType(taskType);

    // 2. Embed user message once (reused for routing, skill retrieval, and fingerprinting)
    const taskEmbedding = await this.responseHistory.getEmbedder().embed(userMessage);

    // 3. Select strategy — embedding router adds semantic routing signal
    const embeddingScores = this.embeddingRouter.hasData
      ? this.embeddingRouter.scoreStrategiesFromEmbedding(taskEmbedding, this.strategies)
      : undefined;
    const strategy = selectStrategy(this.strategies, taskType, {
      epsilon: this.config.epsilon,
      embeddingWeight: embeddingScores ? 0.20 : 0,
      // Rebalance: reduce habitat weight when embedding routing is active
      habitatWeight: embeddingScores ? 0.05 : 0.15,
    }, { noveltyArchive: this.noveltyArchive, embeddingScores });

    // 4. Get relevant skills — semantic retrieval when embedder available,
    //    falls back to task-type matching. Merge with genome skillRefs.
    const semanticSkills = this.skillLibrary.hasEmbedder()
      ? await this.skillLibrary.getSkillsBySimilarity(taskEmbedding)
      : await this.skillLibrary.getSkillsForTask(taskType);
    const refSkills = await this.skillLibrary.getSkillsByIds(strategy.genome.skillRefs);
    const seen = new Set<string>();
    const skills: Skill[] = [];
    for (const s of [...semanticSkills, ...refSkills]) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        skills.push(s);
      }
      if (skills.length >= 5) break;
    }

    // 4. Build LLM config with conversation history
    const llmConfig = strategyToLLMConfig(
      strategy,
      this.config.systemPromptTemplate,
      this.config.toolNames,
      skills,
    );
    if (this.conversationHistory.length > 0) {
      llmConfig.messages = [...this.conversationHistory];
    }

    // 4.5. Budget check — block if exceeded
    const budgetCheck = this.budgetTracker.check();
    if (!budgetCheck.allowed) {
      this.auditLog.log(AuditLog.createEntry('budget-exceeded', budgetCheck.reason ?? 'Budget exceeded', {
        strategyId: strategy.genome.id,
      }));
      throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
    }
    if (budgetCheck.warning) {
      this.auditLog.log(AuditLog.createEntry('budget-warning', budgetCheck.reason ?? 'Budget warning', {
        strategyId: strategy.genome.id,
      }));
    }

    // 5. Execute LLM
    const llmResponse = await this.llm.execute(userMessage, llmConfig);

    // 5.5. Record token usage in budget tracker
    this.budgetTracker.record(llmResponse.tokensUsed);

    // Record conversation turn
    this.conversationHistory.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: llmResponse.content },
    );
    // Trim to max history
    const maxMessages = this.config.maxHistoryTurns * 2;
    if (this.conversationHistory.length > maxMessages) {
      this.conversationHistory = this.conversationHistory.slice(-maxMessages);
    }

    // 6. Self-evaluate (local-first, LLM only when needed — #31)
    const task: Task = {
      id: `task_${++this.interactionCounter}`,
      type: taskType,
      prompt: userMessage,
      difficulty: 0.5,
    };

    // Pre-compute response embedding for fingerprinting (reused in local-eval + record)
    const responseEmbedding = await this.responseHistory.getEmbedder().embed(llmResponse.content);

    const localResult = computeLocalEval(llmResponse.content, task, {
      responseHistory: this.responseHistory,
      responseEmbedding,
    });
    const genomeAge = strategy.taskHistory.length;
    const budget: LLMBudget = {
      ...DEFAULT_LLM_BUDGET,
      ...this.config.llmBudget,
    };
    const needsLLM = shouldCallLLMEval(localResult, genomeAge, budget);
    const selfEvalScore = needsLLM
      ? await selfEvaluate(task, llmResponse.content, this.llm)
      : localResult.score;

    // 7. Compute initial hybrid fitness (without user feedback)
    // completion is null in interactive mode — no external evaluator present.
    // hybrid fitness renormalizes over available signals (selfEval only until
    // user feedback arrives). Avoids double-counting selfEval as two signals.
    const fitnessSignal: FitnessSignal = {
      completion: null,
      selfEval: selfEvalScore,
      userFeedback: null,
      engagement: null,
    };
    const hybridFitness = computeHybridFitness(fitnessSignal, this.fitnessWeights ?? undefined);

    // 8. Create task result and update strategy
    const taskResult: TaskResult = {
      taskId: task.id,
      strategyId: strategy.genome.id,
      score: hybridFitness,
      tokensUsed: llmResponse.tokensUsed,
      latencyMs: llmResponse.latencyMs,
      response: llmResponse.content,
      success: hybridFitness > 0.5,
      taskType,
    };

    // Update strategy state
    const prevFitness = strategy.fitness;
    strategy.taskHistory.push(taskResult);
    if (strategy.taskHistory.length > MAX_TASK_HISTORY) {
      strategy.taskHistory.shift();
    }
    // Adaptive EMA: learn fast early (few interactions), stabilize later
    const alpha = Math.max(0.15, 0.5 / (1 + this.interactionCounter * 0.05));
    strategy.fitness = strategy.fitness * (1 - alpha) + hybridFitness * alpha;
    strategy.age++;
    updateTaskTypeMemory(strategy, taskType, hybridFitness);
    rewardModulatedUpdate(strategy, prevFitness);

    // Update novelty archive and MAP-Elites
    const behavior = NoveltyArchive.describe(strategy);
    this.noveltyArchive.add(behavior);
    this.mapElites.insert(strategy.genome, strategy.fitness, behavior);

    // Record experience
    await this.store.recordExperience({
      strategyId: strategy.genome.id,
      taskType,
      taskPrompt: userMessage,
      response: llmResponse.content,
      score: hybridFitness,
      tokensUsed: llmResponse.tokensUsed,
      latencyMs: llmResponse.latencyMs,
      fitnessSignal: selfEvalScore,
    });

    // Record response fingerprint (Point 2 — vector cognition)
    await this.responseHistory.record(taskType, strategy.genome.id, llmResponse.content, hybridFitness);

    // Update embedding router centroid (Point 1 — semantic strategy routing)
    this.embeddingRouter.recordTaskFromEmbedding(strategy.genome.id, taskEmbedding, hybridFitness);

    // Reinforce classifier memory
    this.classifierMemory.adjustWeights(userMessage, taskType, hybridFitness);

    // Track which skills were used and update their effectiveness
    const skillsUsed = skills.map(s => s.id);
    for (const skillId of skillsUsed) {
      await this.skillLibrary.updateSkillFitness(skillId, hybridFitness);
    }

    // Try skill extraction — push new skill into genome's skillRefs
    const extracted = await this.skillExtractor.tryExtract(task, taskResult);
    if (extracted) {
      if (!strategy.genome.skillRefs.includes(extracted.id)) {
        strategy.genome.skillRefs.push(extracted.id);
        if (strategy.genome.skillRefs.length > 10) {
          strategy.genome.skillRefs = strategy.genome.skillRefs.slice(-10);
        }
      }
    }

    // Try tool synthesis if enabled and struggling (Escada 3)
    if (this.toolSynthesizer && hybridFitness < 0.3) {
      const memoryScore = strategy.taskTypeMemory.get(taskType) ?? 1.0;
      if (memoryScore < 0.4 && !this.toolsSynthesized.has(taskType)) {
        this.toolsSynthesized.add(taskType);
        // Fire and forget synthesis to not block interaction
        this.toolSynthesizer.synthesizeTool(taskType, userMessage, strategy.genome.id).then(tool => {
          if (tool && !this.config.toolNames.includes(tool.name)) {
            this.config.toolNames.push(tool.name);
            this.auditLog.log(AuditLog.createEntry('tool-synthesis', `Synthesized tool: ${tool.name} for task type '${taskType}' (by ${tool.createdBy})`, {
              strategyId: strategy.genome.id,
              fitnessBefore: memoryScore,
              fitnessAfter: null,
            }));
          }
        }).catch((err) => {
          console.warn('ToolSynthesis failed for', taskType, err instanceof Error ? err.message : String(err));
        });
      }
    }

    // Create interaction record
    const interaction: Interaction = {
      id: task.id,
      userMessage,
      taskType,
      strategyId: strategy.genome.id,
      response: llmResponse.content,
      selfEvalScore,
      userFeedback: null,
      engagementScore: null,
      engagementMetrics: null,
      hybridFitness,
      tokensUsed: llmResponse.tokensUsed,
      latencyMs: llmResponse.latencyMs,
      timestamp: Date.now(),
      skillsUsed,
    };

    this.interactions.push(interaction);
    this.pendingFeedback = interaction;

    // Start no-reply timeout
    this.clearNoReplyTimer();
    if (this.config.noReplyTimeoutMs > 0) {
      this.noReplyTimer = setTimeout(() => {
        this.reportNoReply();
      }, this.config.noReplyTimeoutMs);
    }

    // Check if consolidation is due (guard against consolidateEvery <= 0)
    if (this.config.consolidateEvery > 0 &&
        this.interactionCounter % this.config.consolidateEvery === 0) {
      await this.runConsolidation();
    }

    return llmResponse.content;
  }

  /** Apply user feedback to the most recent interaction */
  async applyFeedback(score: number): Promise<boolean> {
    if (!this.pendingFeedback) return false;
    this.clearNoReplyTimer();

    const normalizedScore = Math.max(0, Math.min(1, score / 10));
    this.pendingFeedback.userFeedback = normalizedScore;

    await this.finalizeAndRecord({
      completion: null,
      selfEval: this.pendingFeedback.selfEvalScore,
      userFeedback: normalizedScore,
      engagement: this.pendingFeedback.engagementScore,
    });

    return true;
  }

  /** Get current agent status */
  getStatus(): AgentStatus {
    const fitnesses = this.strategies.map(s => s.fitness);
    const avgFitness = fitnesses.length > 0
      ? fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length
      : 0;
    const bestIdx = fitnesses.length > 0
      ? fitnesses.indexOf(Math.max(...fitnesses))
      : -1;

    // Compute population health
    const threshold = this.agentConfig.cullThreshold;
    const healthyCount = this.strategies.filter(s => s.fitness > threshold).length;
    const healthyRatio = this.strategies.length > 0 ? healthyCount / this.strategies.length : 1;
    const populationHealth: 'healthy' | 'struggling' | 'critical' =
      healthyRatio >= 0.6 ? 'healthy' :
      healthyRatio >= 0.3 ? 'struggling' : 'critical';

    return {
      totalInteractions: this.interactionCounter,
      consolidations: this.consolidationCount,
      strategyCount: this.strategies.length,
      avgFitness,
      bestFitness: bestIdx >= 0 ? fitnesses[bestIdx] : 0,
      bestStrategyId: bestIdx >= 0 ? this.strategies[bestIdx].genome.id : 'none',
      mapElitesCoverage: this.mapElites.coverageRatio,
      noveltyArchiveSize: this.noveltyArchive.size,
      skillCount: 0,  // Will be filled asynchronously
      principleCount: 0,  // Will be filled asynchronously
      taskTypeDistribution: { ...this.taskTypeDistribution },
      populationHealth,
      fitnessWeights: this.fitnessWeights,
    };
  }

  /** Get status with async skill count */
  async getFullStatus(): Promise<AgentStatus> {
    const status = this.getStatus();
    const skills = await this.skillLibrary.getAllSkills();
    status.skillCount = skills.length;
    status.principleCount = skills.filter(s => s.type === 'principle').length;
    return status;
  }

  /** Get the best strategy's genome for use by self-coding or external systems */
  getBestGenome(): StrategyGenome | null {
    if (this.strategies.length === 0) return null;
    let best = this.strategies[0];
    for (const s of this.strategies) {
      if (s.fitness > best.fitness) best = s;
    }
    return best.genome;
  }

  /**
   * Create a self-coding config that uses the best evolved strategy.
   * The evolution system learns from patch success/failure via the callback.
   */
  createSelfCodingConfig(projectRoot: string): { genome?: StrategyGenome; onPatchResult: (result: PatchResult) => void } {
    const genome = this.getBestGenome() ?? undefined;
    const strategyId = genome?.id;

    return {
      genome,
      onPatchResult: (result: PatchResult) => {
        if (!strategyId) return;
        const strategy = this.strategies.find(s => s.genome.id === strategyId);
        if (!strategy) return;

        // Feed patch outcome as fitness signal
        const fitnessDelta = result.success ? 0.3 : -0.2;
        strategy.fitness += fitnessDelta;

        // Update task-type memory for 'self-coding' tasks
        updateTaskTypeMemory(strategy, 'self-coding', result.success ? 0.8 : 0.2);
      },
    };
  }

  /** Get all strategies (for inspection) */
  getStrategies(): Strategy[] {
    return this.strategies;
  }

  /** Clear conversation history (start fresh context) */
  clearHistory(): void {
    this.conversationHistory = [];
    this.sessionTurnCount = 0;
  }

  /** Get conversation history */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  /** Get all skills (for inspection) */
  async getSkills(): Promise<Skill[]> {
    return this.skillLibrary.getAllSkills();
  }

  /** Get the audit log (for inspection) */
  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  /** Get the budget tracker (for inspection) */
  getBudgetTracker(): BudgetTracker {
    return this.budgetTracker;
  }

  /** Get the rollback manager (for inspection) */
  getRollback(): PopulationRollback {
    return this.rollback;
  }

  /** Get interaction history */
  getInteractions(): Interaction[] {
    return this.interactions;
  }

  /** Save full state to storage */
  async save(): Promise<void> {
    for (const strategy of this.strategies) {
      await this.store.saveStrategy(strategy);
    }

    const grid = this.mapElites.getGrid();
    const cells: MapElitesCell[] = [];
    for (const cell of grid) {
      if (cell) cells.push(cell);
    }
    await this.store.saveGrid(cells);

    // Save agent metadata
    await this.store.saveMetadata('interactionCounter', String(this.interactionCounter));
    await this.store.saveMetadata('consolidationCount', String(this.consolidationCount));
    await this.store.saveMetadata('taskTypeDistribution', JSON.stringify(this.taskTypeDistribution));
    await this.store.saveMetadata('conversationHistory', JSON.stringify(this.conversationHistory));
    await this.store.saveMetadata('sessionTurnCount', String(this.sessionTurnCount));
    await this.store.saveMetadata('classifierMemory', this.classifierMemory.serialize());
  }

  /** Manually trigger consolidation */
  async runConsolidation(): Promise<void> {
    // Safety: snapshot population before consolidation
    const configState = {
      mutationRate: this.agentConfig.mutationRate,
      epsilon: this.config.epsilon,
      skillExtractionThreshold: this.config.skillExtractionThreshold,
      cullThreshold: this.agentConfig.cullThreshold,
    };
    this.rollback.snapshot(this.strategies, `consolidation_${this.consolidationCount}`, configState);

    // Fitness decay — force strategies to prove value continuously
    applyFitnessDecay(this.strategies);

    // Collapse detection — penalize strategies producing identical outputs
    for (const strategy of this.strategies) {
      const collapse = this.responseHistory.detectCollapse(strategy.genome.id);
      if (collapse?.collapsed) {
        strategy.fitness -= 0.3; // heavy penalty for degenerate strategies
      }
    }

    consolidate(this.strategies, this.agentConfig, this.mapElites, {}, this.noveltyArchive);
    this.consolidationCount++;

    // Decay task type memory for all strategies
    applyTaskMemoryDecay(this.strategies);

    // Decay skill fitness
    await this.skillLibrary.decaySkills();

    // Distill principles from experience for each observed task type
    for (const taskType of Object.keys(this.taskTypeDistribution)) {
      await this.principleDistiller.distill(taskType);
    }

    // Compute avg fitness for use by arch evolution and rollback
    const avgFitnessForArch = this.strategies.length > 0
      ? this.strategies.reduce((sum, s) => sum + s.fitness, 0) / this.strategies.length
      : 0;

    // Architecture Evolution — A/B test flow (Escada 3)
    if (this.archEvolution) {
      const activeProposal = this.archEvolution.getActiveProposal();

      if (activeProposal?.status === 'testing') {
        // Evaluate ongoing A/B test
        const verdict = this.archEvolution.evaluateCycle(avgFitnessForArch);
        if (verdict === 'reject') {
          // Rollback config to pre-proposal state
          this.restoreConfigFromSnapshot();
          this.auditLog.log(AuditLog.createEntry('arch-proposal', `Rejected proposal: ${activeProposal.description} (fitness ${activeProposal.fitnessAfterApply?.toFixed(3)} vs baseline ${activeProposal.fitnessBeforeApply.toFixed(3)})`, {
            strategyId: 'system',
            updates: activeProposal.configUpdates,
          }));
        } else if (verdict === 'accept') {
          this.auditLog.log(AuditLog.createEntry('arch-proposal', `Accepted proposal: ${activeProposal.description} (fitness improved)`, {
            strategyId: 'system',
            updates: activeProposal.configUpdates,
          }));
        }
      } else if (this.consolidationCount % 5 === 0) {
        // Propose new changes every 5 cycles when no active test
        const currentConfig = {
          mutationRate: this.agentConfig.mutationRate,
          epsilon: this.config.epsilon ?? 0,
          skillExtractionThreshold: this.config.skillExtractionThreshold ?? 0,
          cullThreshold: this.agentConfig.cullThreshold,
          noveltyWeight: this.agentConfig.noveltyWeight,
          elitismRate: this.agentConfig.elitismRate,
        };
        const stats = this.getStatus();
        const metrics = `Avg Fitness: ${stats.avgFitness.toFixed(2)}\nHealth: ${stats.populationHealth}\nTask Distribution: ${JSON.stringify(stats.taskTypeDistribution)}\nCurrent Config: ${JSON.stringify(currentConfig)}`;

        const proposal = await this.archEvolution.proposeChanges(metrics, currentConfig);
        if (proposal) {
          const updates = this.archEvolution.startTesting(proposal, avgFitnessForArch);
          for (const [key, value] of Object.entries(updates)) {
            // Only apply known numeric config keys that have validated bounds
            const bounds = CONFIG_BOUNDS[key];
            if (!bounds || typeof value !== 'number' || isNaN(value)) continue;
            const clamped = Math.max(bounds.min, Math.min(bounds.max, value));
            if (key in this.config) (this.config as unknown as Record<string, unknown>)[key] = clamped;
            if (key in this.agentConfig) (this.agentConfig as unknown as Record<string, unknown>)[key] = clamped;
          }
          this.auditLog.log(AuditLog.createEntry('arch-proposal', `Started A/B test: ${proposal.description}`, {
            strategyId: 'system',
            updates: proposal.configUpdates,
          }));
        }
      }
    }

    // Calibrate fitness weights based on self-eval vs user feedback correlation
    this.fitnessWeights = await calibrateWeights(this.store);

    // Check population health — rescue if too many strategies are struggling
    this.checkPopulationHealth();

    // Safety: check for fitness degradation after consolidation
    if (this.rollback.checkDegradation(avgFitnessForArch)) {
      const latest = this.rollback.getLatestSnapshot();
      if (latest) {
        const restored = this.rollback.restore(latest.id);
        if (restored) {
          this.strategies = restored.strategies;
          this.applyConfigState(restored.configState);
          this.rollback.resetDegradation();
          this.auditLog.log(AuditLog.createEntry('rollback', `Auto-rollback: fitness degraded >20% for 3 cycles. Restored snapshot ${latest.id}`, {
            fitnessBefore: avgFitnessForArch,
            fitnessAfter: latest.avgFitness,
            rollbackId: latest.id,
          }));
        }
      }
    }
  }

  /** Restore config from the latest snapshot (used when arch proposal is rejected). */
  private restoreConfigFromSnapshot(): void {
    const latest = this.rollback.getLatestSnapshot();
    if (!latest) return;
    const restored = this.rollback.restore(latest.id);
    if (restored) this.applyConfigState(restored.configState);
  }

  /** Apply a saved config state to the current agent/config. */
  private applyConfigState(state?: Record<string, number>): void {
    if (!state) return;
    if (state.mutationRate !== undefined) this.agentConfig.mutationRate = state.mutationRate;
    if (state.epsilon !== undefined) this.config.epsilon = state.epsilon;
    if (state.skillExtractionThreshold !== undefined) this.config.skillExtractionThreshold = state.skillExtractionThreshold;
    if (state.cullThreshold !== undefined) this.agentConfig.cullThreshold = state.cullThreshold;
  }

  /** Rescue the population if too many strategies are below cullThreshold */
  private checkPopulationHealth(): void {
    const threshold = this.agentConfig.cullThreshold;
    const healthyCount = this.strategies.filter(s => s.fitness > threshold).length;
    const minHealthy = Math.ceil(this.config.strategyCount * this.agentConfig.rescueThreshold);

    if (healthyCount >= minHealthy) return;
    if (this.mapElites.filledCells < 1) return;

    const rescueCount = Math.min(
      4,
      Math.max(1, minHealthy - healthyCount),
    );

    for (let i = 0; i < rescueCount; i++) {
      const strategy = rescueFromElites({
        mapElites: this.mapElites,
        mutationRate: this.agentConfig.mutationRate,
        config: this.agentConfig,
      });
      if (!strategy) break;
      this.strategies.push(strategy);
    }
  }

  private async finalizePendingInteraction(currentMessage: string, currentTimestamp: number): Promise<void> {
    if (!this.pendingFeedback) return;
    this.clearNoReplyTimer();

    // Compute auto-engagement from the user's reply behavior
    const metrics = buildAutoMetrics(
      this.pendingFeedback.timestamp,
      currentTimestamp,
      currentMessage,
      this.sessionTurnCount,
    );

    // Merge any externally-reported signals
    if (this.pendingFeedback.engagementMetrics) {
      metrics.emojiReaction = this.pendingFeedback.engagementMetrics.emojiReaction;
      metrics.blocked = this.pendingFeedback.engagementMetrics.blocked;
      metrics.readButIgnored = this.pendingFeedback.engagementMetrics.readButIgnored;
    }

    const engScore = computeEngagementScore(metrics);
    this.pendingFeedback.engagementScore = engScore;
    this.pendingFeedback.engagementMetrics = metrics;

    await this.finalizeAndRecord({
      completion: null,
      selfEval: this.pendingFeedback.selfEvalScore,
      userFeedback: this.pendingFeedback.userFeedback,
      engagement: engScore,
    });
  }

  /**
   * Report external engagement signals (emoji, blocked, readButIgnored)
   * for the pending interaction. Call before the next chat() or reportNoReply().
   */
  reportEngagement(signals: Partial<Pick<EngagementMetrics, 'emojiReaction' | 'blocked' | 'readButIgnored'>>): void {
    if (!this.pendingFeedback) return;

    // Initialize metrics shell if needed
    if (!this.pendingFeedback.engagementMetrics) {
      this.pendingFeedback.engagementMetrics = {
        replied: false,
        replyLatencyMs: null,
        replyLength: null,
        turnCount: this.sessionTurnCount,
        emojiReaction: false,
        dismissed: false,
        blocked: false,
        readButIgnored: false,
      };
    }

    if (signals.emojiReaction !== undefined) {
      this.pendingFeedback.engagementMetrics.emojiReaction = signals.emojiReaction;
    }
    if (signals.blocked !== undefined) {
      this.pendingFeedback.engagementMetrics.blocked = signals.blocked;
    }
    if (signals.readButIgnored !== undefined) {
      this.pendingFeedback.engagementMetrics.readButIgnored = signals.readButIgnored;
    }
  }

  /**
   * Report that the user did not reply (timeout).
   * Integrations call this when no response arrives within a timeout window.
   */
  async reportNoReply(): Promise<void> {
    if (!this.pendingFeedback) return;
    this.clearNoReplyTimer();

    const metrics: EngagementMetrics = {
      replied: false,
      replyLatencyMs: null,
      replyLength: null,
      turnCount: this.sessionTurnCount,
      emojiReaction: this.pendingFeedback.engagementMetrics?.emojiReaction ?? false,
      dismissed: false,
      blocked: this.pendingFeedback.engagementMetrics?.blocked ?? false,
      readButIgnored: this.pendingFeedback.engagementMetrics?.readButIgnored ?? false,
    };

    const engScore = computeEngagementScore(metrics);
    this.pendingFeedback.engagementScore = engScore;
    this.pendingFeedback.engagementMetrics = metrics;

    await this.finalizeAndRecord({
      completion: null,
      selfEval: this.pendingFeedback.selfEvalScore,
      userFeedback: this.pendingFeedback.userFeedback,
      engagement: engScore,
    });
  }

  /** Shared helper: compute hybrid fitness, update strategy, record experience, clear pending. */
  private async finalizeAndRecord(signal: FitnessSignal): Promise<void> {
    if (!this.pendingFeedback) return;

    const newFitness = computeHybridFitness(signal, this.fitnessWeights ?? undefined);
    this.pendingFeedback.hybridFitness = newFitness;

    const strategy = this.strategies.find(
      s => s.genome.id === this.pendingFeedback!.strategyId,
    );
    if (strategy) {
      strategy.fitness = strategy.fitness * 0.9 + newFitness * 0.1;
      updateTaskTypeMemory(strategy, this.pendingFeedback.taskType, newFitness);
    }

    await this.store.recordExperience({
      strategyId: this.pendingFeedback.strategyId,
      taskType: this.pendingFeedback.taskType,
      taskPrompt: this.pendingFeedback.userMessage,
      response: this.pendingFeedback.response,
      score: newFitness,
      tokensUsed: this.pendingFeedback.tokensUsed,
      latencyMs: this.pendingFeedback.latencyMs,
      fitnessSignal: this.pendingFeedback.selfEvalScore,
      userFeedback: this.pendingFeedback.userFeedback ?? undefined,
      engagementScore: this.pendingFeedback.engagementScore ?? undefined,
      engagementMetrics: this.pendingFeedback.engagementMetrics
        ? JSON.stringify(this.pendingFeedback.engagementMetrics)
        : undefined,
    });

    this.pendingFeedback = null;
  }

  private clearNoReplyTimer(): void {
    if (this.noReplyTimer !== null) {
      clearTimeout(this.noReplyTimer);
      this.noReplyTimer = null;
    }
  }

  private trackTaskType(taskType: TaskType): void {
    this.taskTypeDistribution[taskType] = (this.taskTypeDistribution[taskType] ?? 0) + 1;
  }

  private async loadMetadata(): Promise<void> {
    const counter = await this.store.loadMetadata('interactionCounter');
    if (counter) {
      const parsed = parseInt(counter, 10);
      if (!isNaN(parsed)) this.interactionCounter = parsed;
    }

    const consolidations = await this.store.loadMetadata('consolidationCount');
    if (consolidations) {
      const parsed = parseInt(consolidations, 10);
      if (!isNaN(parsed)) this.consolidationCount = parsed;
    }

    const dist = await this.store.loadMetadata('taskTypeDistribution');
    if (dist) {
      try {
        this.taskTypeDistribution = JSON.parse(dist);
      } catch {
        // Corrupted data — start fresh
        this.taskTypeDistribution = {};
      }
    }

    const history = await this.store.loadMetadata('conversationHistory');
    if (history) {
      try {
        this.conversationHistory = JSON.parse(history);
      } catch {
        this.conversationHistory = [];
      }
    }

    const turns = await this.store.loadMetadata('sessionTurnCount');
    if (turns) {
      const parsed = parseInt(turns, 10);
      if (!isNaN(parsed)) this.sessionTurnCount = parsed;
    }

    const classifierData = await this.store.loadMetadata('classifierMemory');
    if (classifierData) {
      this.classifierMemory = ClassifierMemory.deserialize(classifierData);
    }
  }
}
