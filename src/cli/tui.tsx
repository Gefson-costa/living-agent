#!/usr/bin/env node
// ================================================================
//  Living Agent — TUI (Ink)
//
//  Modern terminal UI with live status, command palette, and
//  natural-language feedback.
//
//  Usage:
//    npx tsx src/cli/tui.tsx                    # Anthropic + SQLite
//    npx tsx src/cli/tui.tsx --mock             # Mock adapter
//    npx tsx src/cli/tui.tsx --classic          # Fallback to readline REPL
//    npx tsx src/cli/tui.tsx --ollama --model=deepseek-r1:7b
// ================================================================

import 'dotenv/config';
import type { LLMAdapter, StorageAdapter, Strategy } from '../core/types.js';
import type { AgentStatus } from '../agent/interaction.js';

// ── Classic mode fallback ────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--classic')) {
  await import('./repl-classic.js');
} else {
  await runTui();
}

async function runTui(): Promise<void> {

// ── Ink imports (dynamic so --classic never loads them) ───────
const React = await import('react');
const { useState, useEffect, useCallback, useRef } = React;
const { render, Box, Text, Static, useInput, useApp } = await import('ink');
const { default: TextInput } = await import('ink-text-input');

const { LivingAgent } = await import('../agent/living-agent.js');
const { MockAdapter, AnthropicAdapter, OpenAICompatibleAdapter } = await import('../llm/adapter.js');
const { MemoryStore } = await import('../storage/memory-store.js');
const { SqliteStore } = await import('../storage/sqlite-store.js');
const { SelfCodingLoop } = await import('../self-coding/loop.js');

// ── Parse arguments ──────────────────────────────────────────

const useMock = args.includes('--mock');
const useDeepSeek = args.includes('--deepseek');
const useGroq = args.includes('--groq');
const useOllama = args.includes('--ollama');
const useMemory = args.includes('--memory');
const dbArg = args.find(a => a.startsWith('--db='));
const modelArg = args.find(a => a.startsWith('--model='));
const DEFAULT_DB = 'living-agent.sqlite';

function createAdapter(): LLMAdapter {
  if (useMock) return new MockAdapter();
  if (useDeepSeek) {
    const model = modelArg?.slice(8) ?? undefined;
    return new OpenAICompatibleAdapter({ provider: 'deepseek', model });
  }
  if (useGroq) {
    const model = modelArg?.slice(8) ?? undefined;
    return new OpenAICompatibleAdapter({ provider: 'groq', model });
  }
  if (useOllama) {
    const model = modelArg?.slice(8) ?? 'llama3';
    return new OpenAICompatibleAdapter({ provider: 'ollama', model });
  }
  if (!process.env.ANTHROPIC_API_KEY) return new MockAdapter();
  return new AnthropicAdapter();
}

function createStore(): StorageAdapter {
  if (useMemory) return new MemoryStore();
  const dbPath = dbArg ? dbArg.slice(5) : DEFAULT_DB;
  return new SqliteStore(dbPath);
}

function getModeName(): string {
  if (useMock) return 'mock';
  if (useDeepSeek) return `deepseek${modelArg ? ':' + modelArg.slice(8) : ''}`;
  if (useGroq) return `groq${modelArg ? ':' + modelArg.slice(8) : ''}`;
  if (useOllama) return `ollama:${modelArg?.slice(8) ?? 'llama3'}`;
  return 'anthropic';
}

// ── Natural language feedback ────────────────────────────────

const FEEDBACK_WORDS: Record<string, number> = {
  // PT
  péssimo: 1, pessimo: 1, horrível: 1, horrivel: 1,
  ruim: 3, fraco: 3, meh: 4,
  ok: 5, médio: 5, medio: 5, razoável: 5, razoavel: 5,
  bom: 7, legal: 7, bacana: 7,
  ótimo: 9, otimo: 9, excelente: 9, incrível: 9, incrivel: 9,
  perfeito: 10, impecável: 10, impecavel: 10,
  // EN
  terrible: 1, awful: 1, horrible: 1,
  bad: 3, poor: 3, weak: 3,
  okay: 5, fine: 5, average: 5, decent: 5,
  good: 7, nice: 7,
  great: 9, excellent: 9, amazing: 9, awesome: 9, fantastic: 9,
  perfect: 10, flawless: 10,
};

function parseFeedback(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const num = parseFloat(trimmed);
  if (!isNaN(num) && num >= 0 && num <= 10) return num;
  const score = FEEDBACK_WORDS[trimmed];
  if (score !== undefined) return score;
  return null;
}

// ── Sparkline ────────────────────────────────────────────────

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map(v => SPARK_CHARS[Math.round(((v - min) / range) * (SPARK_CHARS.length - 1))])
    .join('');
}

// ── Commands ─────────────────────────────────────────────────

interface Command {
  name: string;
  description: string;
}

const COMMANDS: Command[] = [
  { name: '/status', description: 'Show agent statistics' },
  { name: '/strategies', description: 'List strategies with fitness' },
  { name: '/principles', description: 'Show learned principles' },
  { name: '/clear', description: 'Clear conversation history' },
  { name: '/consolidate', description: 'Trigger evolution cycle' },
  { name: '/self-code', description: 'Run self-coding loop' },
  { name: '/save', description: 'Save agent state' },
  { name: '/help', description: 'Show help' },
  { name: '/quit', description: 'Quit (auto-saves)' },
];

// ── Message type ─────────────────────────────────────────────

interface ChatMsg {
  id: number;
  role: 'user' | 'agent' | 'system';
  text: string;
}

// ── Components ───────────────────────────────────────────────

function StatusHeader({ status, modeName, fitnessHistory }: {
  status: AgentStatus | null;
  modeName: string;
  fitnessHistory: number[];
}) {
  if (!status) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  const healthColor = status.populationHealth === 'healthy'
    ? 'green'
    : status.populationHealth === 'struggling'
      ? 'yellow'
      : 'red';

  const spark = sparkline(fitnessHistory.slice(-20));

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
      <Text>
        <Text color="cyan">{spark || '▁'}</Text>
        {' '}
        <Text color={healthColor} bold>{status.populationHealth}</Text>
        {'  '}
        <Text dimColor>{modeName}</Text>
        {'  '}
        <Text>gen:{status.consolidations}</Text>
        {'  '}
        <Text>{status.strategyCount} strats</Text>
        {'  '}
        <Text>best:{status.bestFitness.toFixed(2)}</Text>
      </Text>
    </Box>
  );
}

function ChatMessage({ msg }: { msg: ChatMsg }) {
  const color = msg.role === 'user' ? 'cyan' : msg.role === 'agent' ? 'green' : undefined;
  const prefix = msg.role === 'user' ? 'you> ' : msg.role === 'agent' ? 'agent> ' : '';
  const dimmed = msg.role === 'system';

  return (
    <Box paddingX={1}>
      <Text dimColor={dimmed}>
        {prefix && <Text color={color} bold>{prefix}</Text>}
        {msg.text}
      </Text>
    </Box>
  );
}

function ChatArea({ messages }: { messages: ChatMsg[] }) {
  const past = messages.slice(0, -10);
  const recent = messages.slice(-10);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {past.length > 0 && (
        <Static items={past}>
          {(msg) => (
            <ChatMessage key={msg.id} msg={msg} />
          )}
        </Static>
      )}
      {recent.map(msg => (
        <ChatMessage key={msg.id} msg={msg} />
      ))}
    </Box>
  );
}

function CommandPalette({ filter, selected, commands }: {
  filter: string;
  selected: number;
  commands: Command[];
}) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>Commands</Text>
      {commands.map((cmd, i) => (
        <Box key={cmd.name}>
          <Text
            color={i === selected ? 'yellow' : undefined}
            bold={i === selected}
            inverse={i === selected}
          >
            {' '}{cmd.name.padEnd(16)}{cmd.description}
          </Text>
        </Box>
      ))}
      {commands.length === 0 && (
        <Text dimColor>  No commands match &quot;{filter}&quot;</Text>
      )}
    </Box>
  );
}

function InputBar({ value, onChange, onSubmit, loading, showHint }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  loading: boolean;
  showHint: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor={loading ? 'yellow' : 'green'} paddingX={1}>
        {loading ? (
          <Text color="yellow">thinking...</Text>
        ) : (
          <Box>
            <Text color="green" bold>{'> '}</Text>
            <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
          </Box>
        )}
      </Box>
      {showHint && !loading && (
        <Box paddingX={2}>
          <Text dimColor>Type / to see commands | feedback words: great, good, ok, bad...</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Main App ─────────────────────────────────────────────────

function App({ agent, store, modeName }: {
  agent: InstanceType<typeof LivingAgent>;
  store: StorageAdapter;
  modeName: string;
}) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [fitnessHistory, setFitnessHistory] = useState<number[]>([]);
  const [hasPendingInteraction, setHasPendingInteraction] = useState(false);
  const msgIdRef = useRef(0);

  const nextId = () => ++msgIdRef.current;

  const addMessage = useCallback((role: ChatMsg['role'], text: string) => {
    setMessages(prev => [...prev, { id: nextId(), role, text }]);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const st = await agent.getFullStatus();
      setAgentStatus(st);
      if (st.bestFitness > 0) {
        setFitnessHistory(prev => {
          const next = [...prev, st.bestFitness];
          return next.length > 20 ? next.slice(-20) : next;
        });
      }
    } catch { /* ignore during init */ }
  }, [agent]);

  useEffect(() => {
    refreshStatus();
    const st = agent.getStatus();
    if (st.totalInteractions > 0) {
      addMessage('system', `Resumed: ${st.totalInteractions} interactions, ${st.strategyCount} strategies`);
    }
    addMessage('system', 'Living Agent v0.1.0 — type /help for commands');
  }, []);

  const paletteFilter = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
  const filteredCommands = paletteOpen
    ? COMMANDS.filter(c => c.name.toLowerCase().includes(paletteFilter) || c.description.toLowerCase().includes(paletteFilter))
    : [];

  useInput((ch, key) => {
    if (loading) return;

    if (key.escape) {
      if (paletteOpen) {
        setPaletteOpen(false);
        setInput('');
        setPaletteIdx(0);
      }
      return;
    }

    if (ch === 'c' && key.ctrl) {
      agent.save().then(() => {
        if ('close' in store && typeof (store as any).close === 'function') {
          (store as any).close();
        }
        exit();
      });
      return;
    }
  });

  useEffect(() => {
    if (input === '/') {
      setPaletteOpen(true);
      setPaletteIdx(0);
    } else if (!input.startsWith('/')) {
      setPaletteOpen(false);
    }
  }, [input]);

  useEffect(() => {
    if (paletteIdx >= filteredCommands.length) {
      setPaletteIdx(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, paletteIdx]);

  const handleCommand = useCallback(async (cmd: string) => {
    const parts = cmd.split(/\s+/);
    const cmdName = parts[0].toLowerCase();

    switch (cmdName) {
      case '/quit':
      case '/exit':
        addMessage('system', 'Saving...');
        await agent.save();
        if ('close' in store && typeof (store as any).close === 'function') {
          (store as any).close();
        }
        addMessage('system', 'Goodbye!');
        setTimeout(() => exit(), 100);
        break;

      case '/help':
        addMessage('system', [
          'Commands:',
          ...COMMANDS.map(c => `  ${c.name.padEnd(16)}${c.description}`),
          '',
          'Feedback: type a word (bom, great, ok, pessimo...) or number 0-10 after agent replies',
        ].join('\n'));
        break;

      case '/status': {
        const st = await agent.getFullStatus();
        setAgentStatus(st);
        const dist = Object.entries(st.taskTypeDistribution)
          .sort(([, a], [, b]) => b - a)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n');
        addMessage('system', [
          `Interactions: ${st.totalInteractions}  Consolidations: ${st.consolidations}`,
          `Strategies: ${st.strategyCount}  Avg: ${st.avgFitness.toFixed(4)}  Best: ${st.bestFitness.toFixed(4)}`,
          `MAP-Elites: ${(st.mapElitesCoverage * 100).toFixed(1)}%  Novelty: ${st.noveltyArchiveSize}`,
          `Skills: ${st.skillCount}  Principles: ${st.principleCount}`,
          dist ? `Tasks:\n${dist}` : 'No tasks yet',
        ].join('\n'));
        break;
      }

      case '/feedback': {
        const score = parseFloat(parts[1]);
        if (isNaN(score) || score < 0 || score > 10) {
          addMessage('system', 'Usage: /feedback <0-10>');
        } else {
          const applied = await agent.applyFeedback(score);
          if (applied) {
            addMessage('system', `Feedback ${score}/10 applied`);
            setHasPendingInteraction(false);
          } else {
            addMessage('system', 'No pending interaction to rate');
          }
          await refreshStatus();
        }
        break;
      }

      case '/strategies': {
        const strategies = agent.getStrategies();
        const lines = strategies
          .sort((a: Strategy, b: Strategy) => b.fitness - a.fitness)
          .map((s: Strategy) => {
            const expertise = [...s.taskTypeMemory.entries()]
              .filter(([, v]) => v > 0.6)
              .map(([k]) => k)
              .join(', ') || 'none';
            return `  ${s.genome.id.padEnd(10)} fitness=${s.fitness.toFixed(4)}  age=${s.age}  expertise=[${expertise}]`;
          });
        addMessage('system', 'Strategies:\n' + lines.join('\n'));
        break;
      }

      case '/principles': {
        const skills = await agent.getSkills();
        const principles = skills.filter(s => s.type === 'principle');
        if (principles.length === 0) {
          addMessage('system', 'No principles learned yet (distilled during consolidation)');
        } else {
          const lines = principles.map(p =>
            `  [${p.taskTypes.join(',')}] fitness=${p.fitness.toFixed(3)}  ${p.content}`,
          );
          addMessage('system', 'Principles:\n' + lines.join('\n'));
        }
        break;
      }

      case '/clear':
        agent.clearHistory();
        setMessages([]);
        addMessage('system', 'Conversation history cleared');
        break;

      case '/consolidate':
        addMessage('system', 'Running consolidation...');
        setLoading(true);
        await agent.runConsolidation();
        setLoading(false);
        addMessage('system', 'Consolidation complete');
        await refreshStatus();
        break;

      case '/self-code': {
        addMessage('system', 'Starting self-coding improvement loop...');
        setLoading(true);
        const scAdapter = createAdapter();
        const loop = new SelfCodingLoop({
          projectRoot: process.cwd(),
          llm: scAdapter,
          requireHumanReview: true,
        }, store);
        await loop.init();
        const results = await loop.run();
        const stats = loop.getStats();
        const lines = results.map(r => {
          const s = r.success ? (r.merged ? 'merged' : 'pending review') : 'failed';
          return `  ${r.patchId}: ${s}${r.branchName ? ` (${r.branchName})` : ''}`;
        });
        addMessage('system', [
          `Self-code: ${results.length} iteration(s), ${results.filter(r => r.success).length} successful, rate: ${(stats.successRate * 100).toFixed(0)}%`,
          ...lines,
        ].join('\n'));
        setLoading(false);
        break;
      }

      case '/save':
        await agent.save();
        addMessage('system', 'State saved');
        break;

      default:
        addMessage('system', `Unknown command: ${cmdName}. Type /help for commands.`);
    }
  }, [agent, store, addMessage, refreshStatus, exit]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (paletteOpen && filteredCommands.length > 0) {
      const selected = filteredCommands[paletteIdx];
      if (selected) {
        setPaletteOpen(false);
        setPaletteIdx(0);
        setInput('');
        await handleCommand(selected.name);
        return;
      }
    }

    setPaletteOpen(false);
    setInput('');

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed);
      return;
    }

    // Natural language feedback (only when pending interaction exists)
    if (hasPendingInteraction) {
      const score = parseFeedback(trimmed);
      if (score !== null) {
        const applied = await agent.applyFeedback(score);
        if (applied) {
          addMessage('system', `Feedback ${score}/10 applied`);
          setHasPendingInteraction(false);
          await refreshStatus();
          return;
        }
      }
    }

    // Chat
    addMessage('user', trimmed);
    setLoading(true);
    try {
      const response = await agent.chat(trimmed);
      addMessage('agent', response);
      setHasPendingInteraction(true);
    } catch (err) {
      addMessage('system', `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
    await refreshStatus();
  }, [agent, paletteOpen, filteredCommands, paletteIdx, hasPendingInteraction, handleCommand, addMessage, refreshStatus]);

  return (
    <Box flexDirection="column" height={process.stdout.rows || 24}>
      <StatusHeader status={agentStatus} modeName={modeName} fitnessHistory={fitnessHistory} />
      <ChatArea messages={messages} />
      {paletteOpen && (
        <CommandPalette
          filter={paletteFilter}
          selected={paletteIdx}
          commands={filteredCommands}
        />
      )}
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        loading={loading}
        showHint={messages.length < 3}
      />
    </Box>
  );
}

// ── Bootstrap ────────────────────────────────────────────────

const adapter = createAdapter();
const store = createStore();
const modeName = getModeName();

const agent = new LivingAgent(adapter, store, {
  strategyCount: 8,
  consolidateEvery: 20,
});
await agent.init();

render(
  <App agent={agent} store={store} modeName={modeName} />,
  { exitOnCtrlC: false },
);

} // end runTui
