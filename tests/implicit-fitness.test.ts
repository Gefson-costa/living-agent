import { describe, it, expect } from 'vitest';
import { computeEngagementScore, isDismissiveReply, buildAutoMetrics, classifyUserIntent } from '../src/fitness/implicit-fitness.js';
import type { EngagementMetrics } from '../src/core/types.js';

describe('isDismissiveReply', () => {
  it('"ok" is dismissive', () => {
    expect(isDismissiveReply('ok')).toBe(true);
  });

  it('"k" is dismissive', () => {
    expect(isDismissiveReply('k')).toBe(true);
  });

  it('"whatever" is dismissive', () => {
    expect(isDismissiveReply('whatever')).toBe(true);
  });

  it('"OK" is dismissive (case insensitive)', () => {
    expect(isDismissiveReply('OK')).toBe(true);
  });

  it('"Sure." is dismissive (with period)', () => {
    expect(isDismissiveReply('Sure.')).toBe(true);
  });

  it('"That sounds great" is not dismissive', () => {
    expect(isDismissiveReply('That sounds great')).toBe(false);
  });

  it('"Can you explain more about that?" is not dismissive', () => {
    expect(isDismissiveReply('Can you explain more about that?')).toBe(false);
  });

  it('empty string is not dismissive', () => {
    expect(isDismissiveReply('')).toBe(false);
  });
});

describe('classifyUserIntent', () => {
  it('classifies thanks', () => {
    expect(classifyUserIntent('Thank you so much!')).toBe('thanks');
    expect(classifyUserIntent('Perfect, that works')).toBe('thanks');
    expect(classifyUserIntent('awesome')).toBe('thanks');
  });

  it('classifies correction', () => {
    expect(classifyUserIntent("No, that's wrong")).toBe('correction');
    expect(classifyUserIntent('That is incorrect')).toBe('correction');
    expect(classifyUserIntent('Actually, the answer is 42')).toBe('correction');
  });

  it('classifies followUp', () => {
    expect(classifyUserIntent('Can you explain that further?')).toBe('followUp');
    expect(classifyUserIntent('How does that work?')).toBe('followUp');
    expect(classifyUserIntent('Why is that the case?')).toBe('followUp');
  });

  it('classifies dismiss', () => {
    expect(classifyUserIntent('ok')).toBe('dismiss');
    expect(classifyUserIntent('whatever')).toBe('dismiss');
    expect(classifyUserIntent('k')).toBe('dismiss');
  });

  it('classifies rephrase', () => {
    expect(classifyUserIntent('What I meant was something else')).toBe('rephrase');
    expect(classifyUserIntent('Let me rephrase that')).toBe('rephrase');
  });

  it('classifies elaboration', () => {
    expect(classifyUserIntent('What if we also add logging?')).toBe('elaboration');
    expect(classifyUserIntent('Additionally, we need error handling')).toBe('elaboration');
    expect(classifyUserIntent('And another thing to consider')).toBe('elaboration');
  });

  it('classifies neutral', () => {
    expect(classifyUserIntent('The sky is blue')).toBe('neutral');
    expect(classifyUserIntent('I see')).toBe('neutral');
  });
});

describe('computeEngagementScore', () => {
  const baseMetrics: EngagementMetrics = {
    replied: true,
    replyLatencyMs: 3000,
    replyLength: 250,
    turnCount: 3,
    emojiReaction: false,
    dismissed: false,
    blocked: false,
    readButIgnored: false,
  };

  it('quick + long reply scores > 0.7', () => {
    const score = computeEngagementScore(baseMetrics);
    expect(score).toBeGreaterThan(0.7);
  });

  it('slow + dismissive reply scores < 0.4', () => {
    const metrics: EngagementMetrics = {
      ...baseMetrics,
      replyLatencyMs: 400_000,
      replyLength: 2,
      turnCount: 1,
      dismissed: true,
    };
    const score = computeEngagementScore(metrics);
    expect(score).toBeLessThan(0.4);
  });

  it('no reply returns 0.1', () => {
    const metrics: EngagementMetrics = {
      ...baseMetrics,
      replied: false,
    };
    const score = computeEngagementScore(metrics);
    expect(score).toBe(0.1);
  });

  it('blocked returns 0.0', () => {
    const metrics: EngagementMetrics = {
      ...baseMetrics,
      blocked: true,
    };
    const score = computeEngagementScore(metrics);
    expect(score).toBe(0.0);
  });

  it('readButIgnored returns 0.05', () => {
    const metrics: EngagementMetrics = {
      ...baseMetrics,
      readButIgnored: true,
      replied: false,
    };
    const score = computeEngagementScore(metrics);
    expect(score).toBe(0.05);
  });

  it('emoji reaction provides bonus', () => {
    const withoutEmoji = computeEngagementScore(baseMetrics);
    const withEmoji = computeEngagementScore({ ...baseMetrics, emojiReaction: true });
    expect(withEmoji).toBeGreaterThan(withoutEmoji);
  });

  it('score stays in 0..1 range for all extremes', () => {
    // Best case
    const best: EngagementMetrics = {
      replied: true,
      replyLatencyMs: 100,
      replyLength: 1000,
      turnCount: 20,
      emojiReaction: true,
      dismissed: false,
      blocked: false,
      readButIgnored: false,
    };
    expect(computeEngagementScore(best)).toBeLessThanOrEqual(1);
    expect(computeEngagementScore(best)).toBeGreaterThanOrEqual(0);

    // Worst non-special case
    const worst: EngagementMetrics = {
      replied: true,
      replyLatencyMs: 600_000,
      replyLength: 1,
      turnCount: 1,
      emojiReaction: false,
      dismissed: true,
      blocked: false,
      readButIgnored: false,
    };
    expect(computeEngagementScore(worst)).toBeLessThanOrEqual(1);
    expect(computeEngagementScore(worst)).toBeGreaterThanOrEqual(0);
  });

  it('higher turn count improves score', () => {
    const singleTurn = computeEngagementScore({ ...baseMetrics, turnCount: 1 });
    const multiTurn = computeEngagementScore({ ...baseMetrics, turnCount: 5 });
    expect(multiTurn).toBeGreaterThan(singleTurn);
  });

  it('intent "thanks" scores higher than no intent', () => {
    const withoutIntent = computeEngagementScore(baseMetrics);
    const withThanks = computeEngagementScore({ ...baseMetrics, intent: 'thanks' });
    expect(withThanks).toBeGreaterThan(withoutIntent);
  });

  it('intent "dismiss" scores lower than no intent', () => {
    const withoutIntent = computeEngagementScore(baseMetrics);
    const withDismiss = computeEngagementScore({ ...baseMetrics, intent: 'dismiss' });
    expect(withDismiss).toBeLessThan(withoutIntent);
  });
});

describe('buildAutoMetrics', () => {
  it('computes correct latency', () => {
    const metrics = buildAutoMetrics(1000, 4000, 'Hello there!', 2);
    expect(metrics.replyLatencyMs).toBe(3000);
  });

  it('computes reply length', () => {
    const msg = 'This is my reply to your question.';
    const metrics = buildAutoMetrics(1000, 2000, msg, 1);
    expect(metrics.replyLength).toBe(msg.length);
  });

  it('detects dismissed reply', () => {
    const metrics = buildAutoMetrics(1000, 2000, 'ok', 1);
    expect(metrics.dismissed).toBe(true);
  });

  it('marks non-dismissive reply correctly', () => {
    const metrics = buildAutoMetrics(1000, 2000, 'That is a great explanation, thanks!', 1);
    expect(metrics.dismissed).toBe(false);
  });

  it('sets replied to true', () => {
    const metrics = buildAutoMetrics(1000, 2000, 'test', 1);
    expect(metrics.replied).toBe(true);
  });

  it('preserves turn count', () => {
    const metrics = buildAutoMetrics(1000, 2000, 'test', 5);
    expect(metrics.turnCount).toBe(5);
  });

  it('defaults emojiReaction/blocked/readButIgnored to false', () => {
    const metrics = buildAutoMetrics(1000, 2000, 'test', 1);
    expect(metrics.emojiReaction).toBe(false);
    expect(metrics.blocked).toBe(false);
    expect(metrics.readButIgnored).toBe(false);
  });
});
