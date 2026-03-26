#!/usr/bin/env node
// ================================================================
//  Living Agent — CLI REPL
//
//  Interactive command-line interface for the living agent.
//  Usage:
//    npx tsx src/cli/repl.ts                    # Anthropic + SQLite (default)
//    npx tsx src/cli/repl.ts --mock             # Mock adapter (no API key)
//    npx tsx src/cli/repl.ts --deepseek         # DeepSeek adapter
//    npx tsx src/cli/repl.ts --groq             # Groq adapter
//    npx tsx src/cli/repl.ts --ollama           # Ollama (local)
//    npx tsx src/cli/repl.ts --db=custom.sqlite # Custom DB path
//    npx tsx src/cli/repl.ts --memory           # In-memory only (no persistence)
// ================================================================

import 'dotenv/config';
import * as readline from 'node:readline';

import { LivingAgent } from '../agent/living-agent.js';
import { MockAdapter, AnthropicAdapter, OpenAICompatibleAdapter } from '../llm/adapter.js';
import { MemoryStore } from '../storage/memory-store.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { SelfCodingLoop } from '../self-coding/loop.js';
import type { LLMAdapter, StorageAdapter } from '../core/types.js';
import { errorMessage } from '../core/utils.js';
import type { AgentStatus } from '../agent/interaction.js';

// ── Parse arguments ───────────────────────────────────────────

const args = process.argv.slice(2);
const useMock = args.includes('--mock');
const useDeepSeek = args.includes('--deepseek');
const useGroq = args.includes('--groq');
const useOllama = args.includes('--ollama');
const useMemory = args.includes('--memory');
const dbArg = args.find(a => a.startsWith('--db='));
const modelArg = args.find(a => a.startsWith('--model='));
const DEFAULT_DB = 'living-agent.sqlite';

// ── Setup ─────────────────────────────────────────────────────

function createAdapter(): LLMAdapter {
  if (useMock) {
    console.log('[mode] Using MockAdapter (no API calls)');
    return new MockAdapter();
  }

  if (useDeepSeek) {
    const model = modelArg?.slice(8) ?? undefined;
    console.log(`[mode] Using DeepSeek${model ? ` (${model})` : ''}`);
    return new OpenAICompatibleAdapter({ provider: 'deepseek', model });
  }

  if (useGroq) {
    const model = modelArg?.slice(8) ?? undefined;
    console.log(`[mode] Using Groq${model ? ` (${model})` : ''}`);
    return new OpenAICompatibleAdapter({ provider: 'groq', model });
  }

  if (useOllama) {
    const model = modelArg?.slice(8) ?? 'llama3';
    console.log(`[mode] Using Ollama (${model})`);
    return new OpenAICompatibleAdapter({ provider: 'ollama', model });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[warn] No API key found, falling back to MockAdapter');
    return new MockAdapter();
  }

  console.log('[mode] Using AnthropicAdapter');
  return new AnthropicAdapter();
}

function createStore(): StorageAdapter {
  if (useMemory) {
    console.log('[store] In-memory (no persistence)');
    return new MemoryStore();
  }

  const dbPath = dbArg ? dbArg.slice(5) : DEFAULT_DB;
  console.log(`[store] SQLite: ${dbPath}`);
  return new SqliteStore(dbPath);
}

function formatStatus(status: AgentStatus): string {
  const lines = [
    '',
    '╭─── Agent Status ───────────────────────────╮',
    `│  Interactions:    ${String(status.totalInteractions).padStart(6)}                │`,
    `│  Consolidations:  ${String(status.consolidations).padStart(6)}                │`,
    `│  Strategies:      ${String(status.strategyCount).padStart(6)}                │`,
    `│  Avg Fitness:     ${status.avgFitness.toFixed(4).padStart(8)}              │`,
    `│  Best Fitness:    ${status.bestFitness.toFixed(4).padStart(8)}              │`,
    `│  Best Strategy:   ${status.bestStrategyId.padStart(12).slice(0, 12)}          │`,
    `│  MAP-Elites:      ${(status.mapElitesCoverage * 100).toFixed(1).padStart(6)}%             │`,
    `│  Novelty Archive: ${String(status.noveltyArchiveSize).padStart(6)}                │`,
    `│  Skills:          ${String(status.skillCount).padStart(6)}                │`,
    `│  Principles:      ${String(status.principleCount).padStart(6)}                │`,
    '├─── Task Distribution ──────────────────────┤',
  ];

  const dist = status.taskTypeDistribution;
  const types = Object.keys(dist).sort();
  if (types.length === 0) {
    lines.push('│  (no tasks yet)                             │');
  } else {
    for (const type of types) {
      const count = String(dist[type]);
      lines.push(`│  ${type.padEnd(16)} ${count.padStart(6)}                │`);
    }
  }

  lines.push('╰─────────────────────────────────────────────╯');
  lines.push('');

  return lines.join('\n');
}

function printHelp(): void {
  console.log(`
Commands:
  /status      Show agent status and statistics
  /feedback N  Rate last response (0-10)
  /strategies  List all strategies with fitness
  /principles  List learned principles
  /clear       Clear conversation history (new context)
  /consolidate Manually trigger consolidation
  /self-code   Run self-coding improvement loop
  /save        Save agent state
  /help        Show this help
  /quit        Exit the REPL (auto-saves)
`);
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const adapter = createAdapter();
  const store = createStore();

  const agent = new LivingAgent(adapter, store, {
    strategyCount: 8,
    consolidateEvery: 20,
  });
  await agent.init();

  const status = agent.getStatus();
  const resumed = status.totalInteractions > 0;

  console.log('\n  Living Agent v0.1.0');
  if (resumed) {
    console.log(`  Resumed: ${status.totalInteractions} interactions, ${status.strategyCount} strategies`);
  }
  console.log('  Type /help for commands, /quit to exit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'you> ',
  });

  async function shutdown(): Promise<void> {
    console.log('\n[saving...] ');
    await agent.save();
    console.log('[ok] State saved. Goodbye.\n');
    store.close?.();
    process.exit(0);
  }

  // Auto-save on Ctrl+C
  process.on('SIGINT', () => {
    shutdown();
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // ── Commands ─────────────────────────────────
    if (input.startsWith('/')) {
      const parts = input.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      switch (cmd) {
        case '/quit':
        case '/exit':
          await shutdown();
          break;

        case '/help':
          printHelp();
          break;

        case '/status': {
          const st = await agent.getFullStatus();
          console.log(formatStatus(st));
          break;
        }

        case '/feedback': {
          const score = parseFloat(parts[1]);
          if (isNaN(score) || score < 0 || score > 10) {
            console.log('[error] Usage: /feedback <0-10>\n');
          } else {
            const applied = await agent.applyFeedback(score);
            if (applied) {
              console.log(`[ok] Feedback ${score}/10 applied.\n`);
            } else {
              console.log('[info] No pending interaction to rate.\n');
            }
          }
          break;
        }

        case '/strategies': {
          const strategies = agent.getStrategies();
          console.log('\nStrategies:');
          for (const s of strategies.sort((a, b) => b.fitness - a.fitness)) {
            const expertise = [...s.taskTypeMemory.entries()]
              .filter(([_, v]) => v > 0.6)
              .map(([k]) => k)
              .join(', ') || 'none';
            console.log(
              `  ${s.genome.id.padEnd(10)} fitness=${s.fitness.toFixed(4)}  age=${s.age}  expertise=[${expertise}]`,
            );
          }
          console.log('');
          break;
        }

        case '/principles': {
          const skills = await agent.getSkills();
          const principles = skills.filter(s => s.type === 'principle');
          if (principles.length === 0) {
            console.log('\n  No principles learned yet (distilled during consolidation).\n');
          } else {
            console.log('\nLearned Principles:');
            for (const p of principles) {
              console.log(`  [${p.taskTypes.join(',')}] fitness=${p.fitness.toFixed(3)}  ${p.content}`);
            }
            console.log('');
          }
          break;
        }

        case '/clear':
          agent.clearHistory();
          console.log('[ok] Conversation history cleared.\n');
          break;

        case '/consolidate':
          await agent.runConsolidation();
          console.log('[ok] Consolidation complete.\n');
          break;

        case '/self-code': {
          console.log('[self-code] Starting self-coding improvement loop...');
          const loop = new SelfCodingLoop({
            projectRoot: process.cwd(),
            llm: adapter,
            requireHumanReview: true,
          }, store);
          await loop.init();
          const results = await loop.run();
          const stats = loop.getStats();
          console.log(`[self-code] Complete: ${results.length} iteration(s), ` +
            `${results.filter(r => r.success).length} successful, ` +
            `success rate: ${(stats.successRate * 100).toFixed(0)}%`);
          for (const r of results) {
            const status = r.success ? (r.merged ? 'merged' : 'pending review') : 'failed';
            console.log(`  ${r.patchId}: ${status}${r.branchName ? ` (${r.branchName})` : ''}`);
          }
          console.log('');
          break;
        }

        case '/save':
          await agent.save();
          console.log('[ok] State saved.\n');
          break;

        default:
          console.log(`[error] Unknown command: ${cmd}. Type /help for commands.\n`);
      }

      rl.prompt();
      return;
    }

    // ── Chat ─────────────────────────────────────
    try {
      const response = await agent.chat(input);
      console.log(`\nagent> ${response}\n`);
    } catch (err) {
      console.error(`[error] ${errorMessage(err)}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    shutdown();
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
