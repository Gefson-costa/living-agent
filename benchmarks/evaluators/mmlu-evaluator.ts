// ================================================================
//  MMLU Evaluator — Multi-domain 4-choice multiple choice
//
//  Supports: professional_medicine, professional_law,
//            professional_accounting (and any future MMLU subject).
//
//  Reuses extractAnswer from logiqa-evaluator (same MCQ format).
// ================================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Task, TaskEvaluator } from '../../src/core/types.js';
import { extractAnswer } from './logiqa-evaluator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export { extractAnswer };

export type MMLUSubject = 'medicine' | 'law' | 'accounting';

export interface MMLUItem {
  id: string;
  subject: string;
  question: string;
  options: string[];
  correct_option: number; // 0-indexed: 0=A, 1=B, 2=C, 3=D
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export class MMLUEvaluator implements TaskEvaluator {
  private items: MMLUItem[];
  private goldAnswers = new Map<string, number>();
  private pointer = 0;
  readonly subject: MMLUSubject;

  constructor(subject: MMLUSubject, split: 'train' | 'eval') {
    this.subject = subject;
    const filename = `mmlu-${subject}-${split}.json`;
    const filePath = resolve(__dirname, '..', 'data', filename);
    this.items = JSON.parse(readFileSync(filePath, 'utf-8')) as MMLUItem[];

    for (const item of this.items) {
      this.goldAnswers.set(item.id, item.correct_option);
    }
  }

  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.items[this.pointer % this.items.length];
      this.pointer++;

      const optionsText = item.options
        .map((opt, idx) => `${LETTERS[idx]}. ${opt}`)
        .join('\n');

      tasks.push({
        id: item.id,
        type: `mmlu-${this.subject}`,
        prompt: `${item.question}\n\n${optionsText}\n\nChoose the best answer (A, B, C, or D).`,
        difficulty: 0.6,
        metadata: { correctOption: item.correct_option },
      });
    }
    return tasks;
  }

  score(task: Task, response: string): number {
    const gold = this.goldAnswers.get(task.id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    if (predicted === gold) return 1.0;
    return 0.05;
  }

  getAllItems(): MMLUItem[] {
    return [...this.items];
  }

  scoreById(id: string, response: string): number {
    const gold = this.goldAnswers.get(id);
    if (gold === undefined) return 0;
    const predicted = extractAnswer(response);
    if (predicted === null) return 0;
    return predicted === gold ? 1 : 0;
  }
}
