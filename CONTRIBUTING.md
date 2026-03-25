# Contributing

Thanks for your interest in Living Agent. Here's how to get started.

## Setup

```bash
git clone https://github.com/Gefson-costa/living-agent.git
cd living-agent
npm install
npm test          # 495 tests, ~6s
npm run build     # TypeScript check
```

## Development

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run bench         # benchmarks (mock adapter)
npm run bench:real    # benchmarks (real API, needs key)
```

### Project structure

```
src/
├── core/           Types, constants, config
├── agent/          Main agent, strategy selection, task classification
├── llm/            LLM adapters (Mock, Anthropic, OpenAI-compatible)
├── evolution/      Genome, novelty, MAP-Elites, Elo, evolution engine
├── fitness/        Self-eval, engagement, hybrid scoring
├── learning/       Reward learning, consolidation, task memory
├── skills/         Skill library, extraction, principle distillation
├── safety/         Budget cap, audit log, rollback, protected files
├── self-coding/    Sandbox, patches, tool synthesis, arch evolution
├── storage/        Memory, SQLite, Redis
├── observability/  Langfuse integration
└── cli/            REPL and TUI
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed system overview.

## Making changes

1. Create a branch from `main`
2. Make your changes
3. Run `npm test` and `npm run build` — both must pass
4. Open a PR with a clear description of what and why

### Commit style

We use conventional commits:

```
feat(evolution): add speciation based on genetic distance
fix(safety): rollback check when baseline fitness is zero
docs: update architecture diagram
chore: update dependencies
```

### Code guidelines

- TypeScript strict mode — no `any` unless unavoidable
- Tests for new functionality (Vitest)
- Keep functions small and pure where possible
- No unnecessary abstractions — three similar lines > premature helper

### Protected files

The self-coding system cannot modify safety-critical files. If you change anything in these paths, explain why in your PR:

- `src/safety/`
- `src/fitness/hybrid-fitness.ts`
- `src/evolution/ecology.ts`
- `src/evolution/evolution-engine.ts`
- `src/evolution/elo-tracker.ts`

## Areas where help is welcome

- **New LLM adapters** — Google, Mistral, Cohere
- **Storage backends** — PostgreSQL, DynamoDB
- **Evaluators** — domain-specific task scorers
- **Benchmarks** — new scenarios and datasets
- **Documentation** — tutorials, diagrams, translations

## License

By contributing, you agree that your contributions will be licensed under the [BSL-1.1](LICENSE).
