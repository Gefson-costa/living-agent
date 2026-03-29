// ================================================================
//  LogiQA Evaluator — Logical reasoning, 4-choice multiple choice
//
//  Standard LogiQA metric: extract chosen letter (A/B/C/D) from
//  response, compare to correct_option (0-indexed).
//
//  score() gives a small gradient signal for valid-format wrong answers.
//  scoreById() uses strict binary 0/1 (for final reported metric).
// ================================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Task, TaskEvaluator } from '../../src/core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LogiQAItem {
  id: string;
  context: string;
  query: string;
  options: string[];
  correct_option: number; // 0-indexed: 0=A, 1=B, 2=C, 3=D
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * Extract the chosen letter (A/B/C/D) from an LLM response.
 *
 * Priority:
 * 1. Explicit patterns: "The answer is X", "Answer: X"
 * 2. Last standalone letter A-D in the response
 */
export function extractAnswer(response: string): number | null {
  const upper = response.toUpperCase();

  // 1. Explicit answer patterns (strongest signal)
  const explicit = upper.match(/(?:THE\s+)?ANSWER\s+IS\s*:?\s*([A-D])\b/);
  if (explicit) return LETTERS.indexOf(explicit[1] as typeof LETTERS[number]);

  const labeled = upper.match(/ANSWER\s*:\s*([A-D])\b/);
  if (labeled) return LETTERS.indexOf(labeled[1] as typeof LETTERS[number]);

  // 2. Selection patterns: "choose X", "select X", "option X is correct", "X is correct"
  const selection = upper.match(/(?:CHOOSE|SELECT|PICK)\s+([A-D])\b/);
  if (selection) return LETTERS.indexOf(selection[1] as typeof LETTERS[number]);

  const correct = upper.match(/\b([A-D])\s+IS\s+(?:THE\s+)?(?:CORRECT|RIGHT|BEST)\b/);
  if (correct) return LETTERS.indexOf(correct[1] as typeof LETTERS[number]);

  const optionCorrect = upper.match(/OPTION\s+([A-D])\b/g);
  if (optionCorrect && optionCorrect.length > 0) {
    const lastOpt = optionCorrect[optionCorrect.length - 1];
    const m = lastOpt.match(/([A-D])/);
    if (m) {
      // Only use if in the last 40% of the response
      const pos = upper.lastIndexOf(lastOpt);
      if (pos > upper.length * 0.6) {
        return LETTERS.indexOf(m[1] as typeof LETTERS[number]);
      }
    }
  }

  // 3. Bolded answer: **A**, **B** etc (common in markdown responses)
  const bolded = upper.match(/\*\*([A-D])\*\*/g);
  if (bolded && bolded.length > 0) {
    const last = bolded[bolded.length - 1].match(/([A-D])/);
    if (last) return LETTERS.indexOf(last[1] as typeof LETTERS[number]);
  }

  // 4. Last standalone A-D (word boundary on both sides)
  const allLetters = [...upper.matchAll(/\b([A-D])\b/g)];
  if (allLetters.length > 0) {
    const last = allLetters[allLetters.length - 1];
    return LETTERS.indexOf(last[1] as typeof LETTERS[number]);
  }

  return null;
}

/**
 * Few-shot demonstrations with reasoning chains.
 * These are hand-picked from the training set to cover different reasoning types:
 * syllogism, experimental design, and argument evaluation.
 */
const FEW_SHOT_DEMOS = [
  {
    context: 'Some Cantonese don\'t like chili, so some southerners don\'t like chili.',
    query: 'Which of the following can guarantee the above argument?',
    options: ['Some Cantonese love chili.', 'Some people who like peppers are southerners.', 'All Cantonese are southerners.', 'Some Cantonese like neither peppers nor sweets.'],
    answer: 'C',
    reasoning: 'The argument goes: "Some Cantonese don\'t like chili → some southerners don\'t like chili." For this to be valid, all Cantonese must be southerners (C). If all Cantonese are southerners, then any Cantonese who doesn\'t like chili is also a southerner who doesn\'t like chili.',
  },
  {
    context: 'A research report states that a special education program for children aged 3-5 under study increases their chances of success in future schooling. Therefore, implementing a similar education program for all children will improve them in the future opportunities for success in school education.',
    query: 'Which of the following best illustrates the logical loopholes summarized above?',
    options: ['Children\'s cognitive abilities are constantly changing at the age of 3-5.', 'Establishing such education and training programs on a national basis requires a special public expenditure.', 'Many parents mistakenly believe that early formal education will occupy the time that children would have been able to better explore the world independently.', 'Investigators are unaware that they include a large group of children who have previously received another education.'],
    answer: 'A',
    reasoning: 'The argument generalizes from a study of 3-5 year olds to "all children." The key flaw is assuming what works for one age group works for all. Option A highlights that cognitive abilities change at 3-5, meaning results may not apply to other ages.',
  },
  {
    context: 'There is no doubt that minors should be prohibited from smoking. However, we cannot explicitly ban the use of automatic cigarette vending machines in order to prevent minors from smoking. This ban is just like setting up roadblocks on the road to prohibit driving without a license. These roadblocks naturally prohibit driving without a license, but also block more than 99% of licensed drivers.',
    query: 'In order to evaluate the above argument, which of the following questions is the most important?',
    options: ['Does the proportion of underage smokers in the total number of smokers exceed 1%?', 'How much inconvenience does the ban on the use of automatic vending machines bring to adult cigarette buyers?', 'Whether the proportion of unlicensed drivers in the total number of drivers really does not exceed 1%.', 'Is the harm of minor smoking really as serious as the public thinks?'],
    answer: 'B',
    reasoning: 'The argument uses an analogy: banning vending machines is like roadblocks that block 99% of legitimate users. To evaluate this, we need to know if the analogy holds — does banning vending machines actually inconvenience adult buyers significantly (B)? If not, the analogy fails.',
  },
];

export function buildFewShotPrefix(count: number): string {
  if (count <= 0) return '';
  const demos = FEW_SHOT_DEMOS.slice(0, count);
  const parts = demos.map((d, i) => {
    const opts = d.options.map((o, j) => `${LETTERS[j]}. ${o}`).join('\n');
    return `Example ${i + 1}:\n${d.context}\n\nQuestion: ${d.query}\n\n${opts}\n\nReasoning: ${d.reasoning}\nThe answer is ${d.answer}`;
  });
  return parts.join('\n\n---\n\n') + '\n\n---\n\nNow solve:\n';
}

export class LogiQAEvaluator implements TaskEvaluator {
  private items: LogiQAItem[];
  private goldAnswers = new Map<string, number>();
  private pointer = 0;
  private fewShotCount: number;

  constructor(split: 'train' | 'eval', fewShotCount = 0) {
    const filename = split === 'train' ? 'logiqa-train-200.json' : 'logiqa-eval-200.json';
    const filePath = resolve(__dirname, '..', 'data', filename);
    this.items = JSON.parse(readFileSync(filePath, 'utf-8')) as LogiQAItem[];
    this.fewShotCount = fewShotCount;

    for (const item of this.items) {
      this.goldAnswers.set(item.id, item.correct_option);
    }
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    const fewShotPrefix = buildFewShotPrefix(this.fewShotCount);
    for (let i = 0; i < count; i++) {
      const item = this.items[this.pointer % this.items.length];
      this.pointer++;

      const optionsText = item.options
        .map((opt, idx) => `${LETTERS[idx]}. ${opt}`)
        .join('\n');

      tasks.push({
        id: item.id,
        type: 'logiqa',
        prompt: `${fewShotPrefix}${item.context}\n\nQuestion: ${item.query}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D).`,
        difficulty: 0.6,
        metadata: { correctOption: item.correct_option },
      });
    }
    return tasks;
  }

  /**
   * Fuzzy scoring for ecology evolution (gradient signal).
   * 1.0 = correct, 0.05 = valid letter but wrong, 0 = no valid answer
   */
  score(task: Task, response: string): number {
    const gold = this.goldAnswers.get(task.id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    if (predicted === gold) return 1.0;
    return 0.05; // valid format, wrong answer — tiny gradient signal
  }

  /** Get all items for direct evaluation */
  getAllItems(): LogiQAItem[] {
    return [...this.items];
  }

  /** Binary 0/1 scoring for final reported metric */
  scoreById(id: string, response: string): number {
    const gold = this.goldAnswers.get(id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    return predicted === gold ? 1 : 0;
  }
}
