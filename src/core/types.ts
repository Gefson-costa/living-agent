// ================================================================
//  Living Agent — Types & Interfaces
//
//  One agent, multiple internal strategies competing on tasks.
//  Strategies evolve. Diversity preserved.
// ================================================================

// ── Constants ────────────────────────────────────────────────────

export const MAX_STRATEGIES = 16;
export const MAP_ELITES_SIZE = 8;
export const MAX_ARCHIVE = 500;
export const NOVELTY_K = 15;
export const MAX_TASK_HISTORY = 50;
export const MAX_SKILLS = 200;
export const MAX_TASK_TYPES = 8;

// ── Strategy Genome — the evolved configuration of a strategy ───

export interface StrategyGenome {
  id: string;
  promptStyle: Float32Array;       // -1..1, modulates prompt tone
  toolPreferences: Float32Array;   // 0..1, tool usage weights
  temperature: number;             // 0..2, LLM sampling temperature
  maxTokenBudget: number;          // 100..4096
  reasoningDepth: number;          // 0..1 (0=direct, 1=deep chain-of-thought)
  mutability: number;              // 0.5..2.0, evolvable mutation rate
  learningRate: number;            // 0..0.04, within-lifetime adaptation
  lamarckianRate: number;          // 0..0.15, learned→offspring transfer
  habitatPref: number;             // 0..1, task-type specialization
  fewShotCount: number;            // 0..5, how many exemplars to inject as few-shot
  promptSegments: string[];        // max 3 evolved prompt fragments (EvoPrompt-style)
  skillRefs: string[];             // IDs of skills this strategy activates
}

// ── Strategy — runtime state of a strategy ───────────────────────

export interface StrategyWeights {
  promptStyle: Float32Array;
  toolPreferences: Float32Array;
}

export interface Strategy {
  genome: StrategyGenome;
  fitness: number;                 // accumulated performance
  age: number;                     // cycles survived
  taskHistory: TaskResult[];       // recent results (ring buffer)
  birthWeights: StrategyWeights | null;  // for learning decay
  taskTypeMemory: Map<string, number>;   // per-type expertise
}

// ── Tasks & Evaluation ───────────────────────────────────────────

export interface Task {
  id: string;
  type: string;                    // task category
  prompt: string;
  difficulty: number;              // 0..1
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  strategyId: string;
  score: number;                   // 0..1 from evaluator
  tokensUsed: number;
  latencyMs: number;
  response: string;
  success: boolean;
  taskType: string;
}

// ── Behavior Descriptor — for novelty search ─────────────────────

export interface StrategyBehavior {
  successRate: number;
  taskDiversity: number;
  toolEntropy: number;
  avgTokenEfficiency: number;
  learningMagnitude: number;
}

// ── Ecology Statistics ───────────────────────────────────────────

export interface EcologyStats {
  cycle: number;
  strategyCount: number;
  avgFitness: number;
  bestFitness: number;
  maxAge: number;
  noveltyArchiveSize: number;
  mapElitesCoverage: number;
  births: number;
  deaths: number;
  eloRatings?: Map<string, number>;
  mapElitesAxes?: [string, string];
}

// ── Agent Configuration ──────────────────────────────────────────

export interface AgentConfig {
  strategyCount: number;           // target strategy population (default 16)
  mutationRate: number;
  promptStyleDim: number;          // dimension of promptStyle vector
  toolCount: number;
  noveltyWeight: number;           // 0..1
  elitismRate: number;
  cullThreshold: number;           // fitness below which strategies die
  taskBatchSize: number;
  rescueThreshold: number;         // pop fraction triggering rescue
  toolNames: string[];
  systemPromptTemplate: string;
  // Ablation flags (all default true when undefined)
  enableAdaptiveMutability?: boolean;
  enableCrossover?: boolean;
  enableMapElites?: boolean;
  enableNoveltyBonus?: boolean;
  enableTaskMemory?: boolean;
  enableFitnessDecay?: boolean;
  enableElo?: boolean;
  enableCycleQD?: boolean;
  // Local/small model constraints
  localMode?: boolean;             // enable local model optimizations
  maxTemperature?: number;         // cap temperature range (default 1.0)
  maxTokenCeiling?: number;        // cap maxTokenBudget range (default 4096)
  minTokenBudget?: number;         // floor for maxTokenBudget mutation (default 500)
  concurrency?: number;            // max parallel LLM calls (default 4, use 1-2 for local)
}

// ── LLM Integration ──────────────────────────────────────────────

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface LLMAdapter {
  execute(prompt: string, config: LLMConfig): Promise<LLMResponse>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMConfig {
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  toolNames: string[];
  messages?: ChatMessage[];   // conversation history (newest last)
}

// ── Task Evaluator ───────────────────────────────────────────────

export interface TaskEvaluator {
  generateTasks(count: number): Task[];
  score(task: Task, response: string): number;
}

// ── Ecology Callbacks ────────────────────────────────────────────

export interface EcologyCallbacks {
  onCycleStart?: (cycle: number) => void;
  onCycleEnd?: (stats: EcologyStats) => void;
  onBirth?: (strategy: Strategy) => void;
  onDeath?: (strategy: Strategy) => void;
  onTaskComplete?: (result: TaskResult) => void;
}

// ── Storage Types (Phase 2+) ─────────────────────────────────────

export interface Experience {
  id?: number;
  strategyId: string;
  taskType: string;
  taskPrompt: string;
  response: string;
  score: number;
  tokensUsed: number;
  latencyMs: number;
  fitnessSignal?: number;
  userFeedback?: number;
  engagementScore?: number;
  engagementMetrics?: string;
  createdAt?: string;
}

export interface ExperienceFilter {
  strategyId?: string;
  taskType?: string;
  minScore?: number;
  limit?: number;
}

export interface Skill {
  id: string;
  type: 'code' | 'principle';
  taskTypes: string[];
  content: string;
  fitness: number;
  uses: number;
  successes: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface FitnessWeights {
  completionWeight: number;
  selfEvalWeight: number;
  userFeedbackWeight: number;
  engagementWeight: number;
  selfEvalAccuracy: number;
}

export interface FitnessSignal {
  completion: number | null;
  selfEval: number | null;
  userFeedback: number | null;
  engagement: number | null;
}

export interface EngagementMetrics {
  replied: boolean;
  replyLatencyMs: number | null;
  replyLength: number | null;
  turnCount: number;
  emojiReaction: boolean;
  dismissed: boolean;
  blocked: boolean;
  readButIgnored: boolean;
  intent?: string;
}

export interface MapElitesCell {
  genome: StrategyGenome;
  fitness: number;
}

export interface StorageAdapter {
  saveStrategy(strategy: Strategy): Promise<void>;
  loadStrategies(): Promise<Strategy[]>;
  recordExperience(exp: Experience): Promise<void>;
  queryExperiences(filter: ExperienceFilter): Promise<Experience[]>;
  saveSkill(skill: Skill): Promise<void>;
  getSkills(taskType?: string): Promise<Skill[]>;
  updateSkillFitness(skillId: string, delta: number): Promise<void>;
  pruneSkills(minFitness: number): Promise<number>;
  saveGrid(grid: MapElitesCell[]): Promise<void>;
  loadGrid(): Promise<MapElitesCell[] | null>;
  saveMetadata(key: string, value: string): Promise<void>;
  loadMetadata(key: string): Promise<string | null>;
  close?(): void | Promise<void>;
}

// ── Safety Types (Escada 2.5) ────────────────────────────────────

export interface BudgetConfig {
  maxTokensPerDay: number;      // hard limit, default 1_000_000
  maxCostPerDay: number;        // USD, default 10.0
  warningThreshold: number;     // 0.8 = warn at 80%
  action: 'pause' | 'kill';
}

export interface AuditEntry {
  timestamp: number;
  type: 'mutation' | 'self-code-patch' | 'tool-synthesis' | 'arch-proposal'
      | 'rollback' | 'budget-warning' | 'budget-exceeded' | 'protected-file-violation';
  strategyId: string;
  description: string;
  fitnessBefore: number;
  fitnessAfter: number | null;
  tokensUsed: number;
  approved: boolean;
  rollbackId: string | null;
  updates?: Record<string, any>;
}

// ── Escada 3: Self-Modification ────────────────────────────────

export interface ArchitectureProposal {
  id: string;
  description: string;
  expectedImpact: string;
  configUpdates: Record<string, number>;
  fitnessBeforeApply: number;
  fitnessAfterApply: number | null;
  status: 'proposed' | 'testing' | 'accepted' | 'rejected' | 'rolled-back';
  timestamp: number;
  testCyclesRemaining: number;
}

export interface SafetyConfig {
  budget?: BudgetConfig;
  protectedPaths?: string[];
  enableAudit?: boolean;
  snapshotRetention?: number;   // max snapshots to keep (default 20)
}
