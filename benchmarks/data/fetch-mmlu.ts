#!/usr/bin/env tsx
/**
 * Download MMLU professional subjects from HuggingFace datasets-server API.
 * Uses ONLY Node.js native fetch() — zero external dependencies.
 *
 * Subjects: professional_medicine, professional_law, professional_accounting
 * Splits:   validation → train, test → eval
 *
 * Usage: npx tsx benchmarks/data/fetch-mmlu.ts
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_BASE = 'https://datasets-server.huggingface.co/rows';
const DATASET = 'cais/mmlu';

interface HFRow {
  row: {
    question: string;
    choices: string[];
    answer: number; // 0-3
    subject?: string;
  };
}

interface MMLUItem {
  id: string;
  subject: string;
  question: string;
  options: string[];
  correct_option: number;
}

const SUBJECTS = [
  { config: 'professional_medicine', slug: 'medicine', evalMax: 200 },
  { config: 'professional_law', slug: 'law', evalMax: 200 },
  { config: 'professional_accounting', slug: 'accounting', evalMax: 200 },
] as const;

async function fetchRows(
  config: string,
  split: string,
  offset: number,
  length: number,
): Promise<HFRow[]> {
  const url = `${API_BASE}?dataset=${DATASET}&config=${config}&split=${split}&offset=${offset}&length=${length}`;
  console.log(`  Fetching ${config}/${split} offset=${offset} length=${length}...`);

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'living-agent/1.0' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}: ${await resp.text()}`);
  }

  const data = await resp.json() as { rows: HFRow[] };
  return data.rows;
}

async function fetchAllRows(
  config: string,
  split: string,
  maxItems: number,
): Promise<HFRow[]> {
  const all: HFRow[] = [];
  const PAGE = 100;

  for (let offset = 0; offset < maxItems; offset += PAGE) {
    const length = Math.min(PAGE, maxItems - offset);
    try {
      const rows = await fetchRows(config, split, offset, length);
      all.push(...rows);
      if (rows.length < length) break; // no more data
    } catch (err) {
      console.warn(`  Warning: fetch failed at offset=${offset}: ${err}`);
      break;
    }
  }

  return all;
}

function toItems(rows: HFRow[], subject: string, prefix: string): MMLUItem[] {
  return rows.map((r, i) => ({
    id: `mmlu_${prefix}_${i}`,
    subject,
    question: r.row.question,
    options: r.row.choices,
    correct_option: r.row.answer,
  }));
}

async function main() {
  console.log('Fetching MMLU professional subjects from HuggingFace...\n');

  for (const { config, slug, evalMax } of SUBJECTS) {
    console.log(`\n=== ${config} ===`);

    // Train: validation split (small but sufficient for calibration)
    const trainRows = await fetchAllRows(config, 'validation', 500);
    const trainItems = toItems(trainRows, config, `${slug}_train`);

    // Eval: test split (capped)
    const evalRows = await fetchAllRows(config, 'test', evalMax);
    const evalItems = toItems(evalRows, config, `${slug}_eval`);

    const trainPath = resolve(__dirname, `mmlu-${slug}-train.json`);
    const evalPath = resolve(__dirname, `mmlu-${slug}-eval.json`);

    writeFileSync(trainPath, JSON.stringify(trainItems, null, 2), 'utf-8');
    writeFileSync(evalPath, JSON.stringify(evalItems, null, 2), 'utf-8');

    console.log(`  Train: ${trainItems.length} items → ${trainPath}`);
    console.log(`  Eval:  ${evalItems.length} items → ${evalPath}`);

    // Answer distribution
    const dist = [0, 0, 0, 0];
    for (const item of evalItems) dist[item.correct_option]++;
    console.log(`  Eval answer distribution: A=${dist[0]} B=${dist[1]} C=${dist[2]} D=${dist[3]}`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
