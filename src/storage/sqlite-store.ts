// ================================================================
//  SQLite Store — Persistent StorageAdapter via better-sqlite3
// ================================================================

import { createRequire } from 'node:module';
import type {
  StorageAdapter, Strategy, Experience, ExperienceFilter,
  Skill, MapElitesCell, StrategyGenome,
} from '../core/types.js';
import { MAP_ELITES_SIZE } from '../core/types.js';

const require = createRequire(import.meta.url);

export class SqliteStore implements StorageAdapter {
  private db: any;

  constructor(dbPath: string) {
    this.initDb(dbPath);
  }

  private initDb(dbPath: string): void {
    const Database = require('better-sqlite3');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    this.migrate();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        genome TEXT NOT NULL,
        fitness REAL DEFAULT 0,
        age INTEGER DEFAULT 0,
        task_type_memory TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS experiences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        task_prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        score REAL NOT NULL,
        tokens_used INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        fitness_signal REAL,
        user_feedback REAL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_exp_strategy ON experiences(strategy_id);
      CREATE INDEX IF NOT EXISTS idx_exp_type ON experiences(task_type);
      CREATE INDEX IF NOT EXISTS idx_exp_score ON experiences(score);

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        task_types TEXT NOT NULL,
        content TEXT NOT NULL,
        fitness REAL DEFAULT 0.5,
        uses INTEGER DEFAULT 0,
        successes INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_skill_type ON skills(type);
      CREATE INDEX IF NOT EXISTS idx_skill_fitness ON skills(fitness);

      CREATE TABLE IF NOT EXISTS map_elites_grid (
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        genome TEXT NOT NULL,
        fitness REAL NOT NULL,
        PRIMARY KEY (x, y)
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  private migrate(): void {
    const columns = this.db.pragma('table_info(experiences)') as { name: string }[];
    const columnNames = new Set(columns.map((c: { name: string }) => c.name));

    if (!columnNames.has('engagement_score')) {
      this.db.exec('ALTER TABLE experiences ADD COLUMN engagement_score REAL');
    }
    if (!columnNames.has('engagement_metrics')) {
      this.db.exec('ALTER TABLE experiences ADD COLUMN engagement_metrics TEXT');
    }
  }

  private serializeGenome(g: StrategyGenome): string {
    return JSON.stringify({
      ...g,
      promptStyle: Array.from(g.promptStyle),
      toolPreferences: Array.from(g.toolPreferences),
    });
  }

  private deserializeGenome(json: string): StrategyGenome {
    const obj = JSON.parse(json);
    return {
      ...obj,
      promptStyle: new Float32Array(obj.promptStyle),
      toolPreferences: new Float32Array(obj.toolPreferences),
    };
  }

  async saveStrategy(strategy: Strategy): Promise<void> {
    const memoryObj: Record<string, number> = {};
    for (const [k, v] of strategy.taskTypeMemory) memoryObj[k] = v;

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO strategies (id, genome, fitness, age, task_type_memory, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(
        strategy.genome.id,
        this.serializeGenome(strategy.genome),
        strategy.fitness,
        strategy.age,
        JSON.stringify(memoryObj),
      );
    } catch (err) {
      console.error('SqliteStore.saveStrategy failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async loadStrategies(): Promise<Strategy[]> {
    const rows = this.db.prepare('SELECT * FROM strategies').all();
    return rows.map((row: any) => {
      const memoryObj = JSON.parse(row.task_type_memory || '{}');
      const taskTypeMemory = new Map<string, number>(Object.entries(memoryObj));
      return {
        genome: this.deserializeGenome(row.genome),
        fitness: row.fitness,
        age: row.age,
        taskHistory: [],
        birthWeights: null,
        taskTypeMemory,
      } as Strategy;
    });
  }

  async recordExperience(exp: Experience): Promise<void> {
    try {
      this.db.prepare(`
        INSERT INTO experiences (strategy_id, task_type, task_prompt, response, score, tokens_used, latency_ms, fitness_signal, user_feedback, engagement_score, engagement_metrics)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        exp.strategyId, exp.taskType, exp.taskPrompt, exp.response,
        exp.score, exp.tokensUsed, exp.latencyMs,
        exp.fitnessSignal ?? null, exp.userFeedback ?? null,
        exp.engagementScore ?? null, exp.engagementMetrics ?? null,
      );
    } catch (err) {
      console.error('SqliteStore.recordExperience failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async queryExperiences(filter: ExperienceFilter): Promise<Experience[]> {
    let sql = 'SELECT * FROM experiences WHERE 1=1';
    const params: any[] = [];

    if (filter.strategyId) {
      sql += ' AND strategy_id = ?';
      params.push(filter.strategyId);
    }
    if (filter.taskType) {
      sql += ' AND task_type = ?';
      params.push(filter.taskType);
    }
    if (filter.minScore !== undefined) {
      sql += ' AND score >= ?';
      params.push(filter.minScore);
    }

    sql += ' ORDER BY id DESC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((row: any) => ({
      id: row.id,
      strategyId: row.strategy_id,
      taskType: row.task_type,
      taskPrompt: row.task_prompt,
      response: row.response,
      score: row.score,
      tokensUsed: row.tokens_used,
      latencyMs: row.latency_ms,
      fitnessSignal: row.fitness_signal,
      userFeedback: row.user_feedback,
      engagementScore: row.engagement_score,
      engagementMetrics: row.engagement_metrics,
      createdAt: row.created_at,
    }));
  }

  async saveSkill(skill: Skill): Promise<void> {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO skills (id, type, task_types, content, fitness, uses, successes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        skill.id, skill.type, JSON.stringify(skill.taskTypes),
        skill.content, skill.fitness, skill.uses, skill.successes,
      );
    } catch (err) {
      console.error('SqliteStore.saveSkill failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async getSkills(taskType?: string): Promise<Skill[]> {
    let rows: any[];
    if (taskType) {
      rows = this.db.prepare('SELECT * FROM skills ORDER BY fitness DESC').all();
      rows = rows.filter((r: any) => {
        const types: string[] = JSON.parse(r.task_types);
        return types.includes(taskType);
      });
    } else {
      rows = this.db.prepare('SELECT * FROM skills ORDER BY fitness DESC').all();
    }
    return rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      taskTypes: JSON.parse(row.task_types),
      content: row.content,
      fitness: row.fitness,
      uses: row.uses,
      successes: row.successes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async updateSkillFitness(skillId: string, delta: number): Promise<void> {
    try {
      this.db.prepare(`
        UPDATE skills SET fitness = fitness + ?, uses = uses + 1,
          successes = CASE WHEN ? > 0 THEN successes + 1 ELSE successes END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(delta, delta, skillId);
    } catch (err) {
      console.error('SqliteStore.updateSkillFitness failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async pruneSkills(minFitness: number): Promise<number> {
    const result = this.db.prepare('DELETE FROM skills WHERE fitness < ?').run(minFitness);
    return result.changes;
  }

  async saveGrid(grid: MapElitesCell[]): Promise<void> {
    try {
      const insert = this.db.prepare(`
        INSERT OR REPLACE INTO map_elites_grid (x, y, genome, fitness)
        VALUES (?, ?, ?, ?)
      `);

      const tx = this.db.transaction(() => {
        this.db.prepare('DELETE FROM map_elites_grid').run();
        for (let i = 0; i < grid.length; i++) {
          const cell = grid[i];
          const x = i % MAP_ELITES_SIZE;
          const y = Math.floor(i / MAP_ELITES_SIZE);
          insert.run(x, y, this.serializeGenome(cell.genome), cell.fitness);
        }
      });
      tx();
    } catch (err) {
      console.error('SqliteStore.saveGrid failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async loadGrid(): Promise<MapElitesCell[] | null> {
    const rows = this.db.prepare('SELECT * FROM map_elites_grid ORDER BY y, x').all();
    if (rows.length === 0) return null;
    return rows.map((row: any) => ({
      genome: this.deserializeGenome(row.genome),
      fitness: row.fitness,
    }));
  }

  async saveMetadata(key: string, value: string): Promise<void> {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO metadata (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
      `).run(key, value);
    } catch (err) {
      console.error('SqliteStore.saveMetadata failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async loadMetadata(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
    return row ? (row as any).value : null;
  }

  close(): void {
    this.db.close();
  }
}
