# Examples

## Quickstart

Minimal usage with in-memory storage:

```bash
# With mock adapter (no API key needed)
npx tsx examples/quickstart.ts --mock

# With Anthropic
ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/quickstart.ts
```

## Persistent Storage

SQLite-backed agent that survives restarts:

```bash
npx tsx examples/with-sqlite.ts --mock
```

## Feedback Loop

Demonstrates how explicit user feedback accelerates evolution:

```bash
npx tsx examples/with-feedback.ts --mock
```

## Multi-Provider

Use DeepSeek, Groq, or Ollama:

```bash
DEEPSEEK_API_KEY=sk-... npx tsx examples/multi-provider.ts deepseek
GROQ_API_KEY=gsk_...   npx tsx examples/multi-provider.ts groq
npx tsx examples/multi-provider.ts ollama
```
