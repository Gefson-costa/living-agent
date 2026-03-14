// ================================================================
//  Storage — Unified StorageAdapter interface
//
//  Defines the contract for all storage backends (memory, SQLite,
//  Redis). Strategies, experiences, skills, and MAP-Elites grids.
// ================================================================

// Re-export the interface from types — this file serves as the
// canonical import point for storage-related types.
export type {
  StorageAdapter,
  Experience,
  ExperienceFilter,
  Skill,
  FitnessWeights,
  MapElitesCell,
} from '../core/types.js';
