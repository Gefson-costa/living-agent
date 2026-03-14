// ================================================================
//  Task Evaluator — environment interfaces + math evaluator
// ================================================================

import type { Task, TaskEvaluator } from '../core/types.js';

// ── Math Problem Evaluator ──────────────────────────────────────

type MathOp = '+' | '-' | '*' | '/';

interface MathProblem {
  a: number;
  b: number;
  op: MathOp;
  answer: number;
}

function generateMathProblem(difficulty: number, rng: () => number): MathProblem {
  const ops: MathOp[] = ['+', '-', '*', '/'];
  const op = ops[(rng() * ops.length) | 0];

  const maxVal = 10 + difficulty * 990;
  let a = Math.round((rng() * maxVal - maxVal / 2) * 100) / 100;
  let b = Math.round((rng() * maxVal - maxVal / 2) * 100) / 100;

  if (op === '/' && Math.abs(b) < 0.01) b = 1 + rng() * 9;

  if (difficulty > 0.5) {
    a = Math.round(a * 100) / 100;
    b = Math.round(b * 100) / 100;
  } else {
    a = Math.round(a);
    b = Math.round(b);
  }

  let answer: number;
  switch (op) {
    case '+': answer = a + b; break;
    case '-': answer = a - b; break;
    case '*': answer = a * b; break;
    case '/': answer = a / b; break;
  }

  return { a, b, op, answer };
}

let taskCounter = 0;

export class MathEvaluator implements TaskEvaluator {
  private rng: () => number;
  private problems = new Map<string, MathProblem>();

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const difficulty = this.rng();
      const problem = generateMathProblem(difficulty, this.rng);
      const id = `math_${++taskCounter}`;

      this.problems.set(id, problem);

      const opName = { '+': 'addition', '-': 'subtraction', '*': 'multiplication', '/': 'division' }[problem.op];

      tasks.push({
        id,
        type: opName,
        prompt: `Calculate: ${problem.a} ${problem.op} ${problem.b}. Reply with only the numeric answer.`,
        difficulty,
      });
    }
    return tasks;
  }

  score(task: Task, response: string): number {
    const problem = this.problems.get(task.id);
    if (!problem) return 0;

    const match = response.match(/-?\d+\.?\d*/);
    if (!match) return 0;

    const answer = parseFloat(match[0]);
    if (isNaN(answer)) return 0;

    const expected = problem.answer;
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
}

// ── Generic Evaluator for custom tasks ──────────────────────────

export class CustomEvaluator implements TaskEvaluator {
  private taskGenerator: () => Task[];
  private scorer: (task: Task, response: string) => number;

  constructor(
    taskGenerator: () => Task[],
    scorer: (task: Task, response: string) => number,
  ) {
    this.taskGenerator = taskGenerator;
    this.scorer = scorer;
  }

  generateTasks(count: number): Task[] {
    const all = this.taskGenerator();
    return all.slice(0, count);
  }

  score(task: Task, response: string): number {
    return this.scorer(task, response);
  }
}
