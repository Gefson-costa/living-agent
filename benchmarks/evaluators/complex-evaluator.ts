// ================================================================
//  Complex Task Evaluator — 4 diverse task types for Claim 8
//
//  Types: word-problem, logic, json-extraction, pattern-completion
//  All scored objectively and deterministically.
// ================================================================

import type { Task, TaskEvaluator } from '../../src/core/types.js';

let taskCounter = 0;

type TaskType = 'word-problem' | 'logic' | 'json-extraction' | 'pattern-completion';
const TASK_TYPES: TaskType[] = ['word-problem', 'logic', 'json-extraction', 'pattern-completion'];

// ── Word Problems ────────────────────────────────────────────────

interface WordProblemDef {
  prompt: string;
  answer: number;
}

function generateWordProblem(difficulty: number, rng: () => number): WordProblemDef {
  // difficulty 0..0.5 → 2-step, small numbers
  // difficulty 0.5..1 → 3-step, larger numbers, fractions
  if (difficulty < 0.5) {
    // 2-step: start with X, add/remove, then add/remove
    const start = 5 + ((rng() * 20) | 0);
    const give = 1 + ((rng() * (start - 1)) | 0);
    const buy = 1 + ((rng() * 15) | 0);
    const answer = start - give + buy;
    return {
      prompt: `Alice has ${start} apples. She gives ${give} to Bob, then buys ${buy} more. How many apples does Alice have now? Reply with only the number.`,
      answer,
    };
  }

  // 3-step with fractions
  const start = 12 + ((rng() * 36) | 0);
  // Make divisible by 3 for clean fractions
  const adjusted = start - (start % 3);
  const fraction = rng() < 0.5 ? 3 : 4;
  const giveAway = adjusted / fraction;
  const multiply = 2;
  const remaining = adjusted - giveAway;
  const answer = remaining * multiply;
  const fractionStr = fraction === 3 ? '1/3' : '1/4';
  return {
    prompt: `A store has ${adjusted} items. They sell ${fractionStr} of them, then receive a shipment that doubles the remaining stock. How many items do they have now? Reply with only the number.`,
    answer,
  };
}

function scoreNumeric(response: string, expected: number): number {
  const match = response.match(/-?\d+\.?\d*/);
  if (!match) return 0;
  const answer = parseFloat(match[0]);
  if (isNaN(answer)) return 0;

  if (Math.abs(expected) < 0.001) {
    return Math.abs(answer) < 0.01 ? 1.0 : Math.max(0, 1 - Math.abs(answer));
  }

  const relError = Math.abs((answer - expected) / expected);
  if (relError < 0.001) return 1.0;
  if (relError < 0.01) return 0.9;
  if (relError < 0.05) return 0.7;
  if (relError < 0.1) return 0.5;
  if (relError < 0.3) return 0.2;
  return 0;
}

// ── Logic / Deduction ────────────────────────────────────────────

interface LogicDef {
  prompt: string;
  answer: 'yes' | 'no';
}

const LOGIC_PROBLEMS: ((rng: () => number) => LogicDef)[] = [
  // Simple syllogism (easy)
  () => ({
    prompt: 'All roses are flowers. All flowers need water. Do roses need water? Answer only yes or no.',
    answer: 'yes',
  }),
  () => ({
    prompt: 'All cats are animals. All animals breathe. Do cats breathe? Answer only yes or no.',
    answer: 'yes',
  }),
  () => ({
    prompt: 'All squares are rectangles. All rectangles have four sides. Do squares have four sides? Answer only yes or no.',
    answer: 'yes',
  }),
  // Negation (medium)
  () => ({
    prompt: 'No fish can fly. A salmon is a fish. Can a salmon fly? Answer only yes or no.',
    answer: 'no',
  }),
  () => ({
    prompt: 'No reptiles have fur. A lizard is a reptile. Does a lizard have fur? Answer only yes or no.',
    answer: 'no',
  }),
  () => ({
    prompt: 'All birds have wings. A penguin is a bird. Does a penguin have wings? Answer only yes or no.',
    answer: 'yes',
  }),
  // Contrapositive / 3 premises (hard)
  () => ({
    prompt: 'If it rains, the ground gets wet. The ground is not wet. Is it raining? Answer only yes or no.',
    answer: 'no',
  }),
  () => ({
    prompt: 'All mammals are warm-blooded. No reptiles are warm-blooded. Is any reptile a mammal? Answer only yes or no.',
    answer: 'no',
  }),
  () => ({
    prompt: 'If something is a dog, it is a mammal. If something is a mammal, it is an animal. Rover is a dog. Is Rover an animal? Answer only yes or no.',
    answer: 'yes',
  }),
  () => ({
    prompt: 'All A are B. All B are C. No C are D. Is any A a D? Answer only yes or no.',
    answer: 'no',
  }),
];

function generateLogicProblem(difficulty: number, rng: () => number): LogicDef {
  // Map difficulty to problem index range
  const maxIdx = LOGIC_PROBLEMS.length;
  const range = difficulty < 0.33
    ? [0, 3]         // easy
    : difficulty < 0.66
      ? [3, 6]       // medium
      : [6, maxIdx]; // hard

  const idx = range[0] + ((rng() * (range[1] - range[0])) | 0);
  return LOGIC_PROBLEMS[Math.min(idx, maxIdx - 1)](rng);
}

function scoreLogic(response: string, expected: 'yes' | 'no'): number {
  const lower = response.toLowerCase().trim();
  // Look for yes/no in the response
  const hasYes = /\byes\b/.test(lower);
  const hasNo = /\bno\b/.test(lower);

  if (expected === 'yes' && hasYes && !hasNo) return 1.0;
  if (expected === 'no' && hasNo && !hasYes) return 1.0;
  // Ambiguous — both or neither
  if (hasYes && hasNo) return 0.2;
  if (expected === 'yes' && hasYes) return 0.8;
  if (expected === 'no' && hasNo) return 0.8;
  return 0;
}

// ── JSON Extraction ──────────────────────────────────────────────

interface JsonExtractionDef {
  prompt: string;
  expected: Record<string, string | number>;
}

interface PersonProfile {
  name: string;
  age: number;
  company: string;
  role?: string;
  city?: string;
}

const PERSON_PROFILES: PersonProfile[] = [
  { name: 'John Smith', age: 32, company: 'Google', role: 'engineer', city: 'San Francisco' },
  { name: 'Maria Garcia', age: 28, company: 'Microsoft', role: 'designer', city: 'Seattle' },
  { name: 'Alex Chen', age: 45, company: 'Amazon', role: 'manager', city: 'New York' },
  { name: 'Sarah Johnson', age: 35, company: 'Apple', role: 'analyst', city: 'Austin' },
  { name: 'David Kim', age: 29, company: 'Meta', role: 'researcher', city: 'Boston' },
];

function generateJsonExtraction(difficulty: number, rng: () => number): JsonExtractionDef {
  const profile = PERSON_PROFILES[((rng() * PERSON_PROFILES.length) | 0) % PERSON_PROFILES.length];

  // 2-3 fields for easy, 4-5 for hard
  const numFields = difficulty < 0.5 ? (2 + ((rng() * 2) | 0)) : (4 + ((rng() * 2) | 0));
  const clampedFields = Math.min(numFields, 5);

  const expected: Record<string, string | number> = {};
  const parts: string[] = [];

  expected.name = profile.name;
  parts.push(profile.name);

  expected.age = profile.age;
  parts.push(`age ${profile.age}`);

  if (clampedFields >= 3) {
    expected.company = profile.company;
    parts.push(`works at ${profile.company}`);
  }
  if (clampedFields >= 4 && profile.role) {
    expected.role = profile.role;
    parts.push(`as a ${profile.role}`);
  }
  if (clampedFields >= 5 && profile.city) {
    expected.city = profile.city;
    parts.push(`in ${profile.city}`);
  }

  const description = parts.join(', ');
  const fieldList = Object.keys(expected).join(', ');

  return {
    prompt: `Extract the following fields as JSON: ${fieldList}. Input: "${description}". Reply with only the JSON object.`,
    expected,
  };
}

function scoreJsonExtraction(response: string, expected: Record<string, string | number>): number {
  // Try to parse JSON from response
  let parsed: Record<string, unknown>;
  try {
    // Find JSON object in response
    const jsonMatch = response.match(/\{[^{}]*\}/);
    if (!jsonMatch) return 0;
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return 0;
  }

  // Valid JSON: 0.3 base score
  const fieldKeys = Object.keys(expected);
  const fieldWeight = 0.7 / fieldKeys.length;
  let fieldScore = 0;

  for (const key of fieldKeys) {
    const expectedVal = expected[key];
    const actualVal = parsed[key];
    if (actualVal === undefined || actualVal === null) continue;

    if (typeof expectedVal === 'number') {
      if (Number(actualVal) === expectedVal) fieldScore += fieldWeight;
    } else {
      const expectedStr = String(expectedVal).toLowerCase().trim();
      const actualStr = String(actualVal).toLowerCase().trim();
      if (actualStr === expectedStr) fieldScore += fieldWeight;
    }
  }

  return 0.3 + fieldScore;
}

// ── Pattern Completion ───────────────────────────────────────────

interface PatternDef {
  prompt: string;
  answer: number;
}

function generatePattern(difficulty: number, rng: () => number): PatternDef {
  if (difficulty < 0.33) {
    // Arithmetic sequence
    const start = 1 + ((rng() * 10) | 0);
    const step = 2 + ((rng() * 8) | 0);
    const terms = [start, start + step, start + 2 * step, start + 3 * step];
    const answer = start + 4 * step;
    return {
      prompt: `What comes next in the sequence: ${terms.join(', ')}, ? Reply with only the number.`,
      answer,
    };
  }

  if (difficulty < 0.66) {
    // Geometric sequence (powers of 2 or 3)
    const base = rng() < 0.5 ? 2 : 3;
    const startExp = (rng() * 2) | 0;
    const terms = [
      base ** startExp,
      base ** (startExp + 1),
      base ** (startExp + 2),
      base ** (startExp + 3),
    ];
    const answer = base ** (startExp + 4);
    return {
      prompt: `What comes next in the sequence: ${terms.join(', ')}, ? Reply with only the number.`,
      answer,
    };
  }

  // Quadratic: n^2 sequence
  const offset = (rng() * 3) | 0;
  const terms = [
    (1 + offset) ** 2,
    (2 + offset) ** 2,
    (3 + offset) ** 2,
    (4 + offset) ** 2,
  ];
  const answer = (5 + offset) ** 2;
  return {
    prompt: `What comes next in the sequence: ${terms.join(', ')}, ? Reply with only the number.`,
    answer,
  };
}

// ── ComplexEvaluator ─────────────────────────────────────────────

export class ComplexEvaluator implements TaskEvaluator {
  private rng: () => number;
  private taskMeta = new Map<string, {
    type: TaskType;
    wordProblem?: WordProblemDef;
    logic?: LogicDef;
    jsonExtraction?: JsonExtractionDef;
    pattern?: PatternDef;
  }>();

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      // Round-robin distribution ensures all 4 types appear per batch
      const type = TASK_TYPES[i % TASK_TYPES.length];
      const difficulty = this.rng();
      const id = `complex_${++taskCounter}`;

      let prompt: string;
      const meta: (typeof this.taskMeta extends Map<string, infer V> ? V : never) = { type };

      switch (type) {
        case 'word-problem': {
          const def = generateWordProblem(difficulty, this.rng);
          prompt = def.prompt;
          meta.wordProblem = def;
          break;
        }
        case 'logic': {
          const def = generateLogicProblem(difficulty, this.rng);
          prompt = def.prompt;
          meta.logic = def;
          break;
        }
        case 'json-extraction': {
          const def = generateJsonExtraction(difficulty, this.rng);
          prompt = def.prompt;
          meta.jsonExtraction = def;
          break;
        }
        case 'pattern-completion': {
          const def = generatePattern(difficulty, this.rng);
          prompt = def.prompt;
          meta.pattern = def;
          break;
        }
      }

      this.taskMeta.set(id, meta);

      tasks.push({
        id,
        type,
        prompt,
        difficulty,
        metadata: { taskType: type },
      });
    }
    return tasks;
  }

  score(task: Task, response: string): number {
    const meta = this.taskMeta.get(task.id);
    if (!meta) return 0;

    switch (meta.type) {
      case 'word-problem':
        return meta.wordProblem ? scoreNumeric(response, meta.wordProblem.answer) : 0;
      case 'logic':
        return meta.logic ? scoreLogic(response, meta.logic.answer) : 0;
      case 'json-extraction':
        return meta.jsonExtraction ? scoreJsonExtraction(response, meta.jsonExtraction.expected) : 0;
      case 'pattern-completion':
        return meta.pattern ? scoreNumeric(response, meta.pattern.answer) : 0;
      default:
        return 0;
    }
  }
}
