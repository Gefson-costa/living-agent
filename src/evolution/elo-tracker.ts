// ================================================================
//  Elo Rating — Pairwise Strategy Comparison
//
//  Maintains Elo ratings per strategy based on head-to-head task
//  performance. Complements fitness as a relative ranking signal.
// ================================================================

const DEFAULT_RATING = 1500;
const K = 32;

export class EloTracker {
  private ratings = new Map<string, number>();

  /** Get rating for a strategy (default 1500). */
  getRating(id: string): number {
    return this.ratings.get(id) ?? DEFAULT_RATING;
  }

  /** Get all ratings as a plain object. */
  getAllRatings(): Map<string, number> {
    return new Map(this.ratings);
  }

  /** Record a match result between two strategies. */
  recordMatch(winnerId: string, loserId: string, isDraw = false): void {
    const rW = this.getRating(winnerId);
    const rL = this.getRating(loserId);

    const expectedW = 1 / (1 + 10 ** ((rL - rW) / 400));
    const expectedL = 1 - expectedW;

    const scoreW = isDraw ? 0.5 : 1;
    const scoreL = isDraw ? 0.5 : 0;

    this.ratings.set(winnerId, rW + K * (scoreW - expectedW));
    this.ratings.set(loserId, rL + K * (scoreL - expectedL));
  }

  /** Remove a strategy's rating (e.g. on death). */
  remove(id: string): void {
    this.ratings.delete(id);
  }
}
