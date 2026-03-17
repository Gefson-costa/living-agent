// ================================================================
//  Budget Cap — Hard limits on daily token and cost usage
//
//  Prevents runaway spending by self-coding, tool synthesis, or
//  daemon loops. Config is NOT modifiable by the agent — only via
//  config file or environment variables.
// ================================================================

import type { BudgetConfig } from '../core/types.js';

const DEFAULT_BUDGET: BudgetConfig = {
  maxTokensPerDay: 1_000_000,
  maxCostPerDay: 10.0,
  warningThreshold: 0.8,
  action: 'pause',
};

export interface BudgetUsage {
  tokensToday: number;
  costToday: number;
  percentTokens: number;
  percentCost: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  warning: boolean;
  reason: string | null;
  usage: BudgetUsage;
}

export class BudgetTracker {
  private config: BudgetConfig;
  private tokensToday = 0;
  private costToday = 0;
  private dayStart: number;

  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_BUDGET, ...config };
    this.dayStart = BudgetTracker.startOfDay(Date.now());
  }

  /** Record token and cost usage after an LLM call */
  record(tokensUsed: number, costUsd = 0): void {
    this.maybeResetDay();
    this.tokensToday += tokensUsed;
    this.costToday += costUsd;
  }

  /** Check if the next LLM call is allowed */
  check(): BudgetCheckResult {
    this.maybeResetDay();

    const usage = this.getUsage();
    const percentMax = Math.max(usage.percentTokens, usage.percentCost);

    if (percentMax >= 1.0) {
      return {
        allowed: false,
        warning: true,
        reason: `Budget exceeded: ${(percentMax * 100).toFixed(1)}% used (tokens: ${usage.tokensToday}, cost: $${usage.costToday.toFixed(2)})`,
        usage,
      };
    }

    if (percentMax >= this.config.warningThreshold) {
      return {
        allowed: true,
        warning: true,
        reason: `Budget warning: ${(percentMax * 100).toFixed(1)}% used`,
        usage,
      };
    }

    return {
      allowed: true,
      warning: false,
      reason: null,
      usage,
    };
  }

  /** Get current usage statistics */
  getUsage(): BudgetUsage {
    this.maybeResetDay();
    return {
      tokensToday: this.tokensToday,
      costToday: this.costToday,
      percentTokens: this.config.maxTokensPerDay > 0
        ? this.tokensToday / this.config.maxTokensPerDay
        : 0,
      percentCost: this.config.maxCostPerDay > 0
        ? this.costToday / this.config.maxCostPerDay
        : 0,
    };
  }

  /** Force reset counters (for testing) */
  reset(): void {
    this.tokensToday = 0;
    this.costToday = 0;
    this.dayStart = BudgetTracker.startOfDay(Date.now());
  }

  /** Get the configured action on budget exceeded */
  get action(): 'pause' | 'kill' {
    return this.config.action;
  }

  /** Auto-reset if a new day has started */
  private maybeResetDay(): void {
    const now = BudgetTracker.startOfDay(Date.now());
    if (now > this.dayStart) {
      this.tokensToday = 0;
      this.costToday = 0;
      this.dayStart = now;
    }
  }

  /** Get the start of the current UTC day in ms */
  static startOfDay(ms: number): number {
    const d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }
}
