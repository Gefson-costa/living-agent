// ================================================================
//  Task Classifier — Weighted keyword/pattern-based task type detection
//
//  Classifies user messages into task types for strategy selection
//  and specialization tracking. Uses specificity-weighted keywords
//  and multi-stage disambiguation to resolve ambiguous inputs.
// ================================================================

import type { TaskType } from './interaction.js';
import type { ClassifierMemory } from './classifier-memory.js';

interface PatternRule {
  type: TaskType;
  patterns: RegExp[];
  // Keywords with specificity weights: higher weight = more diagnostic
  keywords: [string, number][];
}

const RULES: PatternRule[] = [
  {
    type: 'coding',
    patterns: [
      /\b(implement|code|program|function|class|method|api|endpoint|debug|fix|refactor|bug|compile)\b/i,
      /\b(typescript|javascript|python|rust|go|java|html|css|sql|regex)\b/i,
      /```[\s\S]*```/,
    ],
    keywords: [
      // High specificity — almost always means coding
      ['function', 3], ['class', 3], ['debug', 3], ['compile', 3], ['syntax', 3],
      ['variable', 3], ['algorithm', 3], ['endpoint', 3], ['unit test', 3],
      ['refactor', 3], ['bug', 3], ['exception', 3], ['api', 2],
      // Medium specificity — could overlap with other types
      ['code', 2], ['implement', 2], ['loop', 2], ['data structure', 2],
      ['test', 1], ['error', 1],
    ],
  },
  {
    type: 'research',
    patterns: [
      /\b(research|look up|what is|who is|when did|where is|how does)\b/i,
      /\b(tell me about|information about)\b/i,
    ],
    keywords: [
      ['research', 3], ['investigate', 3], ['discover', 2],
      ['learn about', 2], ['information', 2],
      // Low specificity — very common words
      ['explain', 1], ['what', 0.5], ['why', 0.5], ['how', 0.5],
      ['find', 1], ['search', 1], ['explore', 1],
    ],
  },
  {
    type: 'analysis',
    patterns: [
      /\b(analy[sz]e|compare|evaluate|assess|examine|interpret|breakdown)\b/i,
      /\b(pros and cons|trade-?offs?|differences?|metrics?|statistics?)\b/i,
    ],
    keywords: [
      ['analyze', 3], ['compare', 3], ['evaluate', 2], ['assess', 2],
      ['metrics', 3], ['statistics', 3], ['insight', 2],
      ['pros', 2], ['cons', 2], ['trend', 2], ['pattern', 1],
      ['review', 1], ['data', 1],
    ],
  },
  {
    type: 'creative',
    patterns: [
      /\b(compose|brainstorm|invent)\b/i,
      /\b(story|poem|essay|song|slogan|narrative|creative)\b/i,
    ],
    keywords: [
      // High specificity — clearly creative
      ['story', 3], ['poem', 3], ['essay', 3], ['song', 3],
      ['slogan', 3], ['narrative', 3], ['creative', 3],
      ['brainstorm', 2], ['compose', 2], ['invent', 2],
      ['imagine', 2], ['design', 1],
    ],
  },
  {
    type: 'summarization',
    patterns: [
      /\b(summari[sz]e|tl;?dr|condense|shorten|recap|digest)\b/i,
      /\b(key points?|main ideas?|in short|nutshell)\b/i,
    ],
    keywords: [
      ['summarize', 3], ['summary', 3], ['tldr', 3],
      ['condense', 3], ['shorten', 3], ['recap', 3],
      ['digest', 2], ['brief', 1], ['overview', 1],
      ['key points', 3], ['main ideas', 3],
    ],
  },
];

// Coding-exclusive terms: if any of these appear alongside a creative match,
// strongly suppress creative in favor of coding
const CODING_EXCLUSIVE = /\b(function|class|api|code|debug|bug|refactor|variable|algorithm|compile|syntax|endpoint|method)\b/i;

// Creative-exclusive terms: if these appear alongside a coding match,
// strongly suppress coding in favor of creative
const CREATIVE_EXCLUSIVE = /\b(story|poem|essay|song|slogan|narrative|creative|brainstorm)\b/i;

/**
 * Classify a user message into a task type.
 * Uses specificity-weighted keyword scoring with multi-stage disambiguation.
 * Returns 'general' as fallback.
 */
export function classifyTask(message: string, memory?: ClassifierMemory): TaskType {
  const lower = message.toLowerCase();
  const scores = new Map<TaskType, number>();

  for (const rule of RULES) {
    let score = 0;

    // Pattern matches (weighted higher)
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        score += 3;
      }
    }

    // Weighted keyword matches
    for (const [keyword, weight] of rule.keywords) {
      if (lower.includes(keyword)) {
        score += weight;
      }
    }

    // Add adaptive boost from classifier memory
    if (memory) {
      score += memory.getMessageBoost(message, rule.type);
    }

    if (score > 0) {
      scores.set(rule.type, score);
    }
  }

  if (scores.size === 0) return 'general';

  // ── Disambiguation: coding vs creative ──────────────────────
  // Both match on "write" and "create" — resolve by checking for
  // type-exclusive terms that remove ambiguity.
  const codingScore = scores.get('coding') ?? 0;
  const creativeScore = scores.get('creative') ?? 0;

  if (codingScore > 0 && creativeScore > 0) {
    const hasCodingExclusive = CODING_EXCLUSIVE.test(message);
    const hasCreativeExclusive = CREATIVE_EXCLUSIVE.test(message);

    if (hasCodingExclusive && !hasCreativeExclusive) {
      scores.set('creative', creativeScore * 0.1);
    } else if (hasCreativeExclusive && !hasCodingExclusive) {
      scores.set('coding', codingScore * 0.1);
    }
    // If both exclusive sets match, let the higher raw score win
  }

  // ── Disambiguation: research vs coding ──────────────────────
  // "How do I use async/await in TypeScript?" triggers both, but
  // the coding-specific language name should win.
  const researchScore = scores.get('research') ?? 0;
  if (codingScore > 0 && researchScore > 0) {
    if (CODING_EXCLUSIVE.test(message) ||
        /\b(typescript|javascript|python|rust|go|java|html|css|sql)\b/i.test(message)) {
      scores.set('research', researchScore * 0.3);
    }
  }

  // ── Disambiguation: analysis vs research ────────────────────
  // "Compare React vs Vue" should be analysis, not research
  const analysisScore = scores.get('analysis') ?? 0;
  if (analysisScore > 0 && researchScore > 0) {
    if (/\b(compare|analy[sz]e|evaluate|assess|pros|cons|trade-?off)\b/i.test(message)) {
      scores.set('research', researchScore * 0.3);
    }
  }

  // Return the highest scoring type
  let best: TaskType = 'general';
  let bestScore = 0;
  for (const [type, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }

  return best;
}
