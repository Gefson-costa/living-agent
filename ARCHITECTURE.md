# Architecture

Living Agent is an AI agent with an **internal ecology of strategies** that compete and evolve based on real task performance. One user-facing agent, many internal strategies, optimized via evolutionary algorithms, with self-modification and safety rails.

**Core thesis**: Instead of a single LLM call with fixed parameters, spawn multiple strategies with different prompt styles, temperature, reasoning depth, and learned specializations. Measure performance through multi-signal fitness. Strategies that perform well reproduce. Poor performers die. The agent continuously improves.

## Module Map

```
src/
├── core/           Types, constants, default config
├── agent/          Interactive agent, strategy selection, task classification
├── llm/            LLM adapters (Mock, Anthropic, OpenAI-compatible), prompt construction
├── evolution/      Genetic algorithms, novelty search, MAP-Elites, Elo
├── fitness/        Self-eval, engagement signals, hybrid scoring
├── learning/       Reward-modulated plasticity, consolidation, task memory
├── skills/         Skill library, extraction (ExpeL-style), principle distillation
├── safety/         Budget caps, audit log, rollback, protected files (Escada 2.5)
├── self-coding/    Sandbox, patch generation, tool synthesis, arch evolution (Escada 3)
├── storage/        Memory, SQLite, Redis adapters
├── observability/  Langfuse integration
├── integrations/   OpenClaw plugin
└── cli/            Interactive REPL and TUI
```

## Data Flow

### Request path: `chat(userMessage)`

```
User message
  │
  ▼
Task Classification ─── weighted keyword patterns + adaptive memory
  │
  ▼
Strategy Selection ──── epsilon-greedy (15% explore, 85% exploit)
  │                     score = expertise + fitness + recency + habitat + novelty
  ▼
Skill Injection ─────── query library by task type, inject into prompt
  │
  ▼
Prompt Construction ─── system prompt modulated by genome:
  │                     personality traits, tool prefs, reasoning depth
  ▼
LLM Call ────────────── temperature, maxTokens, systemPrompt from genome
  │
  ▼
Self-Evaluation ─────── cheap LLM call: "rate 0-10", bias-corrected
  │
  ▼
Hybrid Fitness ──────── weighted fusion of: completion, selfEval,
  │                     userFeedback (late), engagement (late)
  ▼
Learning ────────────── reward-modulated update + task memory + decay
  │
  ▼
Consolidation ───────── every N interactions: elite/adapt/replace cycle
```

### Consolidation cycle (periodic "sleep")

```
1. Sort by fitness (Elo as tiebreaker)
2. Top 25% (elite) → keep unchanged
3. Middle 50% → 5 cycles of reward-modulated learning + decay toward birth
4. Bottom 25% → replace with offspring:
   - selectParents() from elites
   - crossover + mutation → child genome
   - lamarckianTransfer() → copy learned traits to child
   - 50% chance: rescue from MAP-Elites instead
5. Update MAP-Elites grid (rotate axes each cycle)
6. Update novelty archive
```

## Core Abstractions

### Strategy & Genome

A **Strategy** is the runtime unit of evolution:

```typescript
interface Strategy {
  genome: StrategyGenome;                  // evolved parameters
  fitness: number;                         // accumulated performance
  age: number;                             // cycles survived
  taskHistory: TaskResult[];               // recent results (max 50)
  birthWeights: StrategyWeights | null;    // frozen at spawn for learning decay
  taskTypeMemory: Map<string, number>;     // per-type expertise (0..1)
}
```

A **StrategyGenome** encodes all evolvable parameters:

| Gene | Range | Purpose |
|------|-------|---------|
| `promptStyle` | Float32Array, -1..1 | 4D personality vector (precise, creative, concise, thorough, ...) |
| `toolPreferences` | Float32Array, 0..1 | Per-tool affinity |
| `temperature` | 0..1 | LLM sampling temperature |
| `maxTokenBudget` | 100..4096 | Response length budget |
| `reasoningDepth` | 0..1 | Direct answer (0) → deep chain-of-thought (1) |
| `mutability` | 0.5..2.0 | Self-modulating mutation rate |
| `learningRate` | 0..0.04 | Within-lifetime plasticity |
| `lamarckianRate` | 0..0.15 | Learned traits → offspring transfer rate |
| `habitatPref` | 0..1 | Task-type specialization anchor |
| `skillRefs` | string[] | Activated skill library entries |

### Fitness Signals

Fitness is **multi-signal**, fused via weighted average:

| Signal | Weight | Source |
|--------|--------|--------|
| Completion | 50% | Task evaluator (exact match, numeric, etc.) |
| Self-eval | 10% | LLM self-assessment (bias-corrected) |
| User feedback | 20% | Explicit user rating (late, nullable) |
| Engagement | 20% | Implicit: reply latency, length, intent, emoji |

Discordance penalty applies when signals diverge (stdev > 0.3). Weights auto-calibrate via Pearson correlation with user feedback.

### LLM Adapters

```
LLMAdapter (interface)
├── MockAdapter          Deterministic scoring for tests
├── AnthropicAdapter     Claude via @anthropic-ai/sdk (+ OpenRouter fallback)
└── OpenAICompatibleAdapter   DeepSeek, Groq, Together, Ollama
```

### Storage Adapters

```
StorageAdapter (interface)
├── MemoryStore     In-memory (tests, dev)
├── SqliteStore     SQLite via better-sqlite3 (default)
└── RedisStore      Redis via ioredis (optional)
```

## Evolution Pipeline

### Lifecycle of a strategy

```
SPAWN → random genome within config bounds
  │
  ▼
EARLY LIFE → first tasks, fitness accumulates
  │
  ▼
WITHIN-LIFETIME LEARNING (every task)
  ├── rewardModulatedUpdate() → nudge genes by fitness delta
  ├── decayTowardBirth() → spring back to prevent runaway drift
  └── updateTaskTypeMemory() → exponential moving average per type
  │
  ▼
CONSOLIDATION (every N interactions)
  ├── If elite → survive unchanged
  ├── If middle → adapt via learning cycles
  └── If bottom → die, replaced by offspring
  │
  ▼
BEHAVIORAL ARCHIVES
  ├── MAP-Elites → 8x8 grid, rotating axes, quality-diversity
  └── Novelty Archive → K-NN distance (K=15), reward new behaviors
  │
  ▼
ELO RANKING → pairwise comparison, tiebreaker in selection
```

### Mutation

Each gene mutates independently with probability proportional to `mutability`:
- `promptStyle`: 15% chance, gaussian ±0.15
- `toolPreferences`: 15% chance, gaussian ±0.1
- `temperature`: 12% chance, gaussian ±0.3, clamped 0..1
- `maxTokenBudget`: 10% chance, ±400, clamped 100..4096
- `reasoningDepth`: 20% chance, ±0.2
- `mutability`: 10% chance, ±0.2 (self-modulating)
- `learningRate`, `lamarckianRate`: 5% chance (rare, high-impact)

### Crossover

Weighted blend of two parent genomes. Child then mutated.

### Lamarckian transfer

Learned changes (promptStyle/toolPreferences drift from birth) partially copied to offspring, modulated by `lamarckianRate`.

## Self-Coding (Escada 3)

The agent can modify its own source code through a safety-constrained pipeline:

```
Analyze (run tests, LLM issue detection)
  │
  ▼
Generate patches (N candidates, temperature jittered for diversity)
  │
  ▼
Sandbox (git branch, apply patch, commit)
  │
  ▼
Validate (run tests + build, compare to baseline)
  │
  ▼
Merge or rollback
```

### Architecture Evolution

LLM proposes config parameter changes (mutationRate, epsilon, cullThreshold, etc.) based on performance metrics. Changes are A/B tested over 5 cycles with strict acceptance criteria:
- Normal params: +5% fitness margin to accept
- Critical params: +15% fitness margin
- Early rejection: >20% fitness drop

### Tool Synthesis

When a strategy consistently fails at a task type (memoryScore < 0.4), the system can synthesize new tools:
1. Diagnose capability gap
2. LLM generates TypeScript tool code
3. Validate compilation + types
4. Register in tool library

## Safety Rails (Escada 2.5)

| Rail | Purpose |
|------|---------|
| **Budget cap** | Hard daily limits: 1M tokens, $10. Agent cannot modify. |
| **Audit log** | Immutable append-only log of all mutations, patches, proposals. |
| **Protected files** | `src/safety/`, `fitness/hybrid-fitness.ts`, `evolution/ecology.ts`, `evolution/evolution-engine.ts`, `evolution/elo-tracker.ts` — self-coding cannot touch these. |
| **Population rollback** | Snapshots before each consolidation. Auto-rollback if fitness drops >20% for 3 consecutive cycles. |

## Testing

```
tests/
├── 41 test files
├── 495 tests passing
├── ~6s runtime
├── Covers: genome ops, evolution, fitness, learning, safety, self-coding, benchmarks
└── Benchmark suites: MATH-500, GSM8K, SWE-bench, multi-task specialization
```
