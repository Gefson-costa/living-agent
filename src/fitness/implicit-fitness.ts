// ================================================================
//  Implicit Fitness — Engagement-based fitness signals
//
//  Derives fitness from user engagement behavior: reply speed,
//  reply length, conversation continuation, emoji reactions,
//  and negative signals (dismissal, blocking, ignoring).
// ================================================================

import type { EngagementMetrics } from '../core/types.js';

// ── Intent Classification ─────────────────────────────────────

export type UserIntent = 'followUp' | 'elaboration' | 'thanks' | 'rephrase' | 'correction' | 'dismiss' | 'neutral';

const INTENT_SCORES: Record<UserIntent, number> = {
  thanks: 0.25, followUp: 0.2, elaboration: 0.15,
  neutral: 0.0, correction: -0.15, rephrase: -0.2, dismiss: -0.3,
};

export function classifyUserIntent(message: string): UserIntent {
  const m = message.trim().toLowerCase();
  if (isDismissiveReply(message)) return 'dismiss';
  if (/\b(thanks?|thank\s*you|thx|ty|perfect|great|awesome|excellent)\b/i.test(m)) return 'thanks';
  if (/\b(wrong|incorrect|no[,.]?\s*(that'?s|it'?s)|actually|mistake)\b/i.test(m)) return 'correction';
  if (/\b(i\s*mean[t]?|what\s*i\s*(meant|want)|let\s*me\s*rephrase)\b/i.test(m)) return 'rephrase';
  if (/\?(.*)?$/.test(m) && /\b(can\s*you|could\s*you|explain|how|what\s*about|why)\b/i.test(m)) return 'followUp';
  if (/\b(what\s*if|also|additionally|and\s*(then|also)|another)\b/i.test(m)) return 'elaboration';
  return 'neutral';
}

// ── Sub-signal weights ─────────────────────────────────────────

const W_REPLIED = 0.25;
const W_LATENCY = 0.20;
const W_LENGTH = 0.15;
const W_CONTINUATION = 0.15;
const W_EMOJI = 0.10;
const W_INTENT = 0.15;

// Latency thresholds (ms)
const FAST_REPLY_MS = 5_000;       // <=5s is fast
const SLOW_REPLY_MS = 300_000;     // >=5min is slow

// Length thresholds (chars)
const SHORT_REPLY = 10;
const LONG_REPLY = 200;

// ── Dismissive reply patterns ──────────────────────────────────

const DISMISSIVE_PATTERNS = [
  /^(ok|k|kk|okay|sure|whatever|fine|meh|hmm|lol|haha|cool|thx|thanks|ty|yep|yup|nah|nope|idk)\.?$/i,
];

/**
 * Detect if a message is a dismissive/low-effort reply.
 */
export function isDismissiveReply(message: string): boolean {
  const trimmed = message.trim();
  return DISMISSIVE_PATTERNS.some(p => p.test(trimmed));
}

/**
 * Compute an engagement score (0..1) from engagement metrics.
 *
 * Special paths:
 * - blocked → 0.0
 * - readButIgnored → 0.05
 * - no reply → 0.1
 *
 * Normal path: weighted sum of sub-signals.
 */
export function computeEngagementScore(metrics: EngagementMetrics): number {
  // Special negative paths
  if (metrics.blocked) return 0.0;
  if (metrics.readButIgnored) return 0.05;
  if (!metrics.replied) return 0.1;

  let score = 0;

  // 1. Replied (base signal)
  score += W_REPLIED * 1.0;

  // 2. Latency: fast → high, slow → low
  if (metrics.replyLatencyMs !== null) {
    let latencyScore: number;
    if (metrics.replyLatencyMs <= FAST_REPLY_MS) {
      latencyScore = 1.0;
    } else if (metrics.replyLatencyMs >= SLOW_REPLY_MS) {
      latencyScore = 0.0;
    } else {
      // Linear interpolation between fast and slow
      latencyScore = 1.0 - (metrics.replyLatencyMs - FAST_REPLY_MS) / (SLOW_REPLY_MS - FAST_REPLY_MS);
    }
    score += W_LATENCY * latencyScore;
  }

  // 3. Reply length: longer → higher engagement (up to a point)
  if (metrics.replyLength !== null) {
    let lengthScore: number;
    if (metrics.replyLength <= SHORT_REPLY) {
      lengthScore = 0.2;
    } else if (metrics.replyLength >= LONG_REPLY) {
      lengthScore = 1.0;
    } else {
      lengthScore = 0.2 + 0.8 * (metrics.replyLength - SHORT_REPLY) / (LONG_REPLY - SHORT_REPLY);
    }
    // Penalize dismissive replies
    if (metrics.dismissed) {
      lengthScore *= 0.3;
    }
    score += W_LENGTH * lengthScore;
  }

  // 4. Continuation: more turns → more engaged
  if (metrics.turnCount > 1) {
    const continuationScore = Math.min(1.0, (metrics.turnCount - 1) / 5);
    score += W_CONTINUATION * continuationScore;
  }

  // 5. Emoji reaction bonus
  if (metrics.emojiReaction) {
    score += W_EMOJI * 1.0;
  }

  // 6. Intent signal (replaces old negative-only signal)
  if (metrics.intent) {
    const intent = metrics.intent as UserIntent;
    const intentScore = (INTENT_SCORES[intent] + 0.3) / 0.55;
    score += W_INTENT * intentScore;
  } else {
    // Backward compat: no intent → treat as neutral
    const fallback = metrics.dismissed ? 'dismiss' as UserIntent : 'neutral' as UserIntent;
    const intentScore = (INTENT_SCORES[fallback] + 0.3) / 0.55;
    score += W_INTENT * intentScore;
  }

  // Clamp to 0..1
  return Math.max(0, Math.min(1, score));
}

/**
 * Build EngagementMetrics from timestamps and message content.
 * Called automatically when the user's next message arrives.
 */
export function buildAutoMetrics(
  prevTimestamp: number,
  curTimestamp: number,
  curMessage: string,
  turnCount: number,
): EngagementMetrics {
  const replyLatencyMs = curTimestamp - prevTimestamp;
  const replyLength = curMessage.length;
  const dismissed = isDismissiveReply(curMessage);

  return {
    replied: true,
    replyLatencyMs,
    replyLength,
    turnCount,
    emojiReaction: false,     // set externally via reportEngagement
    dismissed,
    blocked: false,           // set externally via reportEngagement
    readButIgnored: false,    // set externally via reportNoReply
    intent: classifyUserIntent(curMessage),
  };
}
