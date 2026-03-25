# Living Agent

[![CI](https://github.com/Gefson-costa/living-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Gefson-costa/living-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kanano/living-agent)](https://www.npmjs.com/package/@kanano/living-agent)

An AI agent with an internal ecology of competing strategies that **evolve at runtime**. Instead of a static prompt and fixed parameters, Living Agent maintains a population of strategy genomes that mutate, crossover, specialize, and improve — with every interaction, on any LLM.

No fine-tuning. No training data. No offline optimization. Pure evolutionary pressure at inference time.

```
User ──> Classify Task ──> Select Best Strategy ──> LLM ──> Response
                                    ^                           |
                                    |     fitness signal        |
                                    └───────────────────────────┘
                                    (self-eval + engagement + evaluator)
```

## What Makes This Different

Most prompt optimization frameworks (DSPy, GEPA, Artemis) run **offline** — optimize once, deploy static. Living Agent evolves **continuously at runtime**:

| Capability | DSPy | GEPA | Artemis | Living Agent |
|---|---|---|---|---|
| Optimizes parameters | - | - | Yes | **Yes** |
| Optimizes prompt text | Yes | Yes | Yes | Roadmap |
| Runs continuously | - | - | - | **Yes** |
| Within-lifetime learning | - | - | - | **Yes** |
| Lamarckian inheritance | - | - | - | **Yes** |
| Model-agnostic | - | Partial | Partial | **Yes** |
| Emergent specialization | - | - | - | **Yes** |

Living Agent is the only open system that combines continuous runtime evolution, within-lifetime learning, and Lamarckian transfer across any LLM provider.

## Benchmarks — Real Results (DeepSeek V3, March 2026)

All benchmarks run with real API calls against DeepSeek V3. No cherry-picking, no synthetic data.

### MATH-500 (Competition-level math — where evolution shines)

| Framework | Accuracy | Method |
|---|---|---|
| Static baseline | 77.6% | Fixed prompt, temp=0.3 |
| **Living Agent (evolved)** | **88.0%** | 10 evolution cycles |
| **Delta** | **+10.4pp** | |

### GSM8K (Grade-school math — ceiling effect)

| Framework | Accuracy | Method |
|---|---|---|
| DSPy zero-shot CoT | 98.0% | No optimization |
| DSPy BootstrapFewShot | 97.5% | Compiled on 50 examples |
| **Living Agent (evolved)** | **97.5%** | 10 evolution cycles |
| Static baseline | 97.0% | Fixed prompt, temp=0.3 |

Head-to-head tie with DSPy at the ceiling. Evolution provides no advantage when the model already solves >97%.

### SWE-bench Verified (Software engineering — 500 real GitHub issues)

| Framework | Accuracy | Method |
|---|---|---|
| No-context static (V1) | 5.2% | Blind prompts, temp=0.3 |
| **With-context static (V2)** | **14.8%** | files_changed + hints_text enriched |
| With-context evolved (V2) | 14.0% | 10 cycles with context-aware prompts |
| **Context enrichment delta** | **+9.6pp** | V1 → V2 (nearly 3x) |

Gold-patch comparison without repo access. Context enrichment (adding `files_changed` and `hints_text` to prompts) nearly **tripled** accuracy. Evolution doesn't improve further here — the bottleneck is information (no repo access), not parameter tuning.

### Multi-Task Specialization (5 task types, 250 eval)

| Framework | Overall | Coding | Research | Creative |
|---|---|---|---|---|
| Static baseline | 77.5% | 62.5% | 97.5% | 32.5% |
| **Living Agent** | **81.5%** | **67.5%** | 97.5% | **47.5%** |
| Delta | +4.0pp | +5.0pp | 0 | **+15.0pp** |

Strategies develop distinct specializations without explicit pressure — different strategies win for different task types. Creative tasks show the largest improvement (+15pp).

### Key Insights

- **Evolution wins on hard tasks:** When the model can't solve everything with default parameters (MATH-500), evolution finds significantly better configurations
- **Ceiling effect on easy tasks:** GSM8K is already >97% — no room to improve
- **Context matters:** SWE-bench accuracy nearly tripled (+9.6pp) just by enriching prompts with file paths and discussion context
- **Specialization emerges naturally:** 15/16 strategies develop distinct task-type preferences across 6 niches
- **Model-agnostic:** All benchmarks auto-detect the available provider (DeepSeek, Anthropic, OpenAI-compatible)

## Quick Start

```bash
npm install @kanano/living-agent
```

```typescript
import { LivingAgent, AnthropicAdapter, SqliteStore } from '@kanano/living-agent';

const agent = new LivingAgent(
  new AnthropicAdapter(),
  new SqliteStore('my-agent.sqlite'),
  { strategyCount: 8, consolidateEvery: 20 },
);

await agent.init();

const response = await agent.chat('Write a sorting algorithm');
console.log(response);

// Optional: explicit feedback (0-10)
await agent.applyFeedback(8);

// Or: implicit engagement is computed automatically
// when the user sends their next message
```

### CLI

```bash
# Mock adapter (no API key needed)
npx @kanano/living-agent --mock

# With Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-... npx @kanano/living-agent

# With DeepSeek
DEEPSEEK_API_KEY=sk-... npx @kanano/living-agent

# In-memory (no persistence)
npx @kanano/living-agent --mock --memory
```

| Command | Description |
|---|---|
| `/status` | Fitness, strategies, coverage |
| `/feedback N` | Rate last response (0-10) |
| `/strategies` | List strategies with fitness |
| `/principles` | Learned principles from experience |
| `/consolidate` | Trigger evolution cycle |
| `/save` | Save state |

## How It Works

### Strategy Genomes

Each strategy carries an evolvable genome that controls LLM behavior:

| Gene | Range | Controls |
|---|---|---|
| `temperature` | 0-2 | Sampling randomness (clamped 0-1 for API) |
| `maxTokenBudget` | 100-4096 | Response length |
| `reasoningDepth` | 0-1 | Direct answer (0) vs deep chain-of-thought (1) |
| `promptStyle` | Float32Array[-1,1] | Style traits: precise, creative, concise, thorough |
| `toolPreferences` | Float32Array[0,1] | Bias toward specific tools |
| `mutability` | 0.5-2.0 | Self-adaptive mutation rate |
| `learningRate` | 0-0.04 | Within-lifetime plasticity |
| `lamarckianRate` | 0-0.15 | How much learned changes pass to offspring |
| `habitatPref` | 0-1 | Task-type niche preference |

### Fitness Signals

Four signals combined with dynamically calibrated weights:

| Signal | Source | Default Weight |
|---|---|---|
| **Completion** | External evaluator score | 0.50 |
| **Self-eval** | LLM rates its own response | 0.10 |
| **User feedback** | Explicit 0-10 rating (optional) | 0.20 |
| **Engagement** | Implicit behavioral signals | 0.20 |

Missing signals are skipped and weights renormalized. Weights auto-calibrate via Pearson correlation between self-eval and user feedback.

### Implicit Engagement

When the user's next message arrives, the system retroactively scores the previous interaction using behavioral signals: reply latency, reply length, dismissive patterns ("ok", "whatever"), continuation depth, emoji reactions, and blocked/ignored states.

### Evolution Cycle

Every N interactions, the population evolves:

1. **Fitness decay** — all strategies multiplied by 0.95 (prevents aristocracy)
2. **Elite** (top 25%) — preserved unchanged
3. **Middle** (50%) — reward-modulated weight updates + decay toward birth weights
4. **Bottom** (25%) — replaced by crossover of top performers + mutation
5. **MAP-Elites rescue** — reintroduces diverse champions from behavioral niches
6. **Principle distillation** — ExpeL-style extraction of successful patterns
7. **Weight calibration** — fitness signal weights adjusted via correlation analysis

### Diversity Preservation

- **Novelty Archive** (500 entries, k=15 NN) — behavioral diversity pressure prevents convergence
- **MAP-Elites** (8x8 grid) — niche preservation across task-diversity x success-rate space
- **Lamarckian Inheritance** — learned adaptations transfer to offspring genomes
- **Self-adaptive mutability** — mutation rate itself evolves per-strategy

## Integration — OpenClaw SDK

Drop evolutionary optimization into any existing agent framework:

```typescript
import { createLivingAgentPlugin } from '@kanano/living-agent/integrations/openclaw';

const plugin = createLivingAgentPlugin(llm, store, { strategyCount: 8 });
await plugin.init();

// Full chat mode (Living Agent handles LLM)
const response = await plugin.chat('Hello');

// Or: config-only mode (you handle LLM with optimized parameters)
const config = plugin.getOptimizedConfig('Write a function');
// → { temperature: 0.26, maxTokens: 1800, systemPrompt: "...", taskType: "coding" }

// Engagement signals from your platform
plugin.reportEngagement({ emojiReaction: true });
await plugin.reportNoReply(); // user didn't respond
```

## Architecture

```
src/                          ~7,200 lines TypeScript
├── core/types.ts             Shared types and interfaces
├── core/config.ts            Default configuration
├── evolution/
│   ├── genome.ts             Create, mutate, crossover genomes
│   ├── novelty.ts            Novelty archive (behavioral diversity)
│   ├── map-elites.ts         MAP-Elites (niche preservation + rescue)
│   └── ecology.ts            Batch-mode evolutionary loop
├── fitness/
│   ├── hybrid-fitness.ts     Multi-signal fitness combiner
│   ├── implicit-fitness.ts   Engagement-based behavioral scoring
│   └── self-eval.ts          LLM self-evaluation
├── learning/
│   ├── reward-learning.ts    Within-lifetime reward-modulated plasticity
│   ├── task-memory.ts        Per-type specialization memory
│   └── consolidation.ts      Periodic evolution + distillation
├── skills/
│   ├── skill-library.ts      Learned skill storage
│   ├── skill-extractor.ts    Extract skills from high-scoring tasks
│   └── principle-distiller.ts  ExpeL-style principle extraction
├── llm/
│   ├── adapter.ts            LLM adapters (Anthropic, OpenAI-compat, Mock)
│   └── prompt-builder.ts     Genome-driven prompt construction
├── agent/
│   ├── living-agent.ts       Main orchestrator
│   ├── task-classifier.ts    6-type weighted keyword classifier
│   └── strategy-selector.ts  Epsilon-greedy selection with expertise scoring
├── storage/
│   ├── memory-store.ts       In-memory (testing)
│   ├── sqlite-store.ts       SQLite (default persistent)
│   └── redis-store.ts        Redis (optional hot-path cache)
├── self-coding/              Self-improvement loop (experimental)
├── integrations/openclaw/    Plugin for agent frameworks
└── cli/                      Interactive TUI
```

## LLM Providers

| Provider | Adapter | Env Variable |
|---|---|---|
| Anthropic Claude | `AnthropicAdapter` | `ANTHROPIC_API_KEY` |
| DeepSeek | `OpenAICompatibleAdapter` | `DEEPSEEK_API_KEY` |
| Together AI | `OpenAICompatibleAdapter` | `TOGETHER_API_KEY` |
| Groq | `OpenAICompatibleAdapter` | `GROQ_API_KEY` |
| OpenRouter | `AnthropicAdapter` (fallback) | `OPENROUTER_API_KEY` |
| Ollama (local) | `OpenAICompatibleAdapter` | `OLLAMA_BASE_URL` |
| Any OpenAI-compatible | `OpenAICompatibleAdapter` | `OPENAI_API_KEY` + `OPENAI_BASE_URL` |

## Testing

```bash
npm test              # 495 tests across 41 test files
npm run build         # TypeScript type check
npm run bench         # Run benchmarks (mock adapter)
npm run bench:real    # Run benchmarks (real API calls)
```

Covers: genome operations, novelty search, MAP-Elites, evaluators, self-eval, hybrid fitness, implicit fitness, reward learning, task memory, consolidation, ecology, evolution engine, storage (memory/sqlite/redis), skill library, skill extraction, principle distillation, task classifier, strategy selector, living agent integration, prompt builder, and OpenClaw plugin.

## Limitations

- **No prompt text evolution yet** — evolves parameters (temperature, reasoning depth, style vectors) but not the prompt text itself. Prompt evolution is planned for Stage 2.
- **Self-coding requires human review by default** — patches are generated and validated in isolated git branches, but auto-merge is opt-in.
- **Ceiling effect on easy tasks** — when the base model already achieves >97% (e.g. GSM8K), evolution provides no advantage.
- **Benchmarks run on DeepSeek V3** — results will vary across models and providers.
- **No safety rails for self-modification** — guardrails (budget cap, audit log, rollback) are planned before enabling autonomous self-coding.

## What's Next

Living Agent is actively developed with a focus on making runtime evolution more powerful and practical:

**Near-term (Q2 2026):**
- **Prompt template evolution** — evolve the actual instruction text, not just parameters
- **Model routing** — automatically select the best model per task type based on performance data
- **Additional benchmarks** — GAIA, AgentBench validation across more domains

**Future directions:**
- **MCP server integration** — expose as a Model Context Protocol server
- **Self-improvement capabilities** — agent analyzes and improves its own code
- **Production tooling** — daemon mode, monitoring, safety guardrails

Contributions, feedback, and collaboration welcome.

## Origin

Born from Zero, an artificial life simulation where creatures with neural brains evolve in a digital ecosystem. The question that started Living Agent: *"Could the same evolutionary dynamics work on AI agents instead of simulated creatures?"*

Every feature came from a research-driven cycle: *Why does fitness stagnate?* → reward hacking literature → inoculation prompting. *Why do populations converge?* → quality-diversity algorithms → CycleQD. *How do biological systems transfer knowledge?* → Lamarckian inheritance → within-lifetime learning.

## License

[BSL-1.1](LICENSE) — free for non-production and non-competitive use. Converts to Apache 2.0 on 2030-03-24. For commercial licensing, contact the author.

## Support

Living Agent is developed in the open by [Kanano](https://codeberg.org/Kanano) from São Tomé and Príncipe.

If this project helps you or your company:
- ⭐ Star the repo
- 💬 Share your use case or results
- 🤝 Contribute improvements
- 💰 [Sponsor development](mailto:gefson.costa@proton.me) (enterprise support, custom features, consulting)

For collaboration, custom development, or enterprise support: **gefson.costa@proton.me**
