import { describe, it, expect } from 'vitest';
import { EloTracker } from '../src/evolution/elo-tracker.js';

describe('EloTracker', () => {
  it('returns default rating of 1500', () => {
    const elo = new EloTracker();
    expect(elo.getRating('unknown')).toBe(1500);
  });

  it('winner gains points and loser loses points', () => {
    const elo = new EloTracker();
    elo.recordMatch('a', 'b');
    expect(elo.getRating('a')).toBeGreaterThan(1500);
    expect(elo.getRating('b')).toBeLessThan(1500);
  });

  it('ratings change by equal and opposite amounts for equal-rated players', () => {
    const elo = new EloTracker();
    elo.recordMatch('a', 'b');
    const gain = elo.getRating('a') - 1500;
    const loss = 1500 - elo.getRating('b');
    expect(gain).toBeCloseTo(loss, 5);
  });

  it('draw: ratings converge', () => {
    const elo = new EloTracker();
    // Give 'a' a higher rating first
    elo.recordMatch('a', 'b');
    const ratingA = elo.getRating('a');
    const ratingB = elo.getRating('b');

    // Now draw — stronger player loses points, weaker gains
    elo.recordMatch('a', 'b', true);
    expect(elo.getRating('a')).toBeLessThan(ratingA);
    expect(elo.getRating('b')).toBeGreaterThan(ratingB);
  });

  it('upset: larger adjustment when weaker player wins', () => {
    const elo = new EloTracker();
    // Give 'a' a big lead
    for (let i = 0; i < 10; i++) elo.recordMatch('a', 'b');
    const ratingA = elo.getRating('a');
    const ratingB = elo.getRating('b');

    // Upset: 'b' beats 'a'
    elo.recordMatch('b', 'a');
    const bGain = elo.getRating('b') - ratingB;

    // Now have a normal match between two equal players
    const elo2 = new EloTracker();
    elo2.recordMatch('x', 'y');
    const xGain = elo2.getRating('x') - 1500;

    // Upset gain should be larger than expected-win gain
    expect(bGain).toBeGreaterThan(xGain);
  });

  it('remove clears rating', () => {
    const elo = new EloTracker();
    elo.recordMatch('a', 'b');
    elo.remove('a');
    expect(elo.getRating('a')).toBe(1500);
    expect(elo.getAllRatings().has('a')).toBe(false);
  });

  it('multiple matches: ratings stabilize', () => {
    const elo = new EloTracker();
    // 'a' wins 60% of the time against 'b'
    for (let i = 0; i < 100; i++) {
      if (i % 5 < 3) {
        elo.recordMatch('a', 'b');
      } else {
        elo.recordMatch('b', 'a');
      }
    }
    // 'a' should be rated higher
    expect(elo.getRating('a')).toBeGreaterThan(elo.getRating('b'));
    // But not infinitely — should plateau
    expect(elo.getRating('a')).toBeLessThan(1700);
  });

  it('getAllRatings returns a copy', () => {
    const elo = new EloTracker();
    elo.recordMatch('a', 'b');
    const ratings = elo.getAllRatings();
    ratings.set('a', 9999);
    expect(elo.getRating('a')).not.toBe(9999);
  });
});
