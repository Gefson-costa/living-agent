// ================================================================
//  Self-Coding Loop — Types
//
//  Defines the data structures for the self-coding system:
//  issues, patches, validation results, and configuration.
// ================================================================

import type { LLMAdapter, StrategyGenome } from '../core/types.js';

export interface SelfCodingConfig {
  projectRoot: string;
  testCommand: string;
  buildCommand: string;
  maxIterations: number;
  branchPrefix: string;
  requireHumanReview: boolean;
  focusAreas: string[];
  excludePatterns: string[];
  llm: LLMAdapter;
  /** Optional evolved genome — modulates temperature and prompt style for patch generation */
  genome?: StrategyGenome;
  /** Callback to report patch results back to the evolution system */
  onPatchResult?: (result: PatchResult) => void;
}

export const DEFAULT_SELF_CODING_CONFIG: Partial<SelfCodingConfig> = {
  testCommand: 'npx vitest run --reporter=json',
  buildCommand: 'npx tsc --noEmit',
  maxIterations: 5,
  branchPrefix: 'self-coding',
  requireHumanReview: true,
  focusAreas: ['src/**/*.ts'],
  excludePatterns: ['src/self-coding/**', 'node_modules/**', 'dist/**'],
};

export type IssueSeverity = 'high' | 'medium' | 'low';
export type IssueType = 'test-failure' | 'dead-code' | 'disconnected-param' | 'missing-test' | 'bug' | 'performance';

export interface CodeIssue {
  type: IssueType;
  severity: IssueSeverity;
  file: string;
  line?: number;
  description: string;
  suggestedFix?: string;
}

export interface PatchFile {
  path: string;
  original: string;
  modified: string;
}

export interface CodePatch {
  id: string;
  issue: CodeIssue;
  files: PatchFile[];
  description: string;
}

export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  duration: number;
}

export interface ValidationResult {
  testsPass: boolean;
  buildPass: boolean;
  testResults: TestResults;
  baseline: TestResults;
}

export interface PatchResult {
  patchId: string;
  success: boolean;
  testsPass: boolean;
  buildPass: boolean;
  fitnessGain: number;
  branchName: string;
  merged: boolean;
}

export interface CodingAttempt {
  id: string;
  issue: CodeIssue;
  patch: CodePatch | null;
  result: PatchResult | null;
  timestamp: number;
}
