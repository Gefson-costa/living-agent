// ================================================================
//  Redis Store — Hot path StorageAdapter via ioredis
//
//  Optional. Falls back to MemoryStore if Redis unavailable.
//  Optimized for real-time strategy selection with sorted sets,
//  hashes, and TTL-based caching.
// ================================================================

import type {
  StorageAdapter, Strategy, Experience, ExperienceFilter,
  Skill, MapElitesCell, StrategyGenome,
} from '../core/types.js';
import { MemoryStore } from './memory-store.js';

export class RedisStore implements StorageAdapter {
  private client: any = null;
  private fallback: MemoryStore;
  private prefix: string;

  constructor(redisUrl?: string, prefix = 'la:') {
    this.prefix = prefix;
    this.fallback = new MemoryStore();
    if (redisUrl) {
      this.initClient(redisUrl);
    }
  }

  private async initClient(url: string): Promise<void> {
    try {
      // ioredis is an optional peer dependency — suppress type resolution
      const moduleName = 'ioredis';
      const { default: Redis } = await import(/* @vite-ignore */ moduleName);
      this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
      await this.client.connect();
    } catch {
      // ioredis not available or connection failed — silent fallback to in-memory
      this.client = null;
    }
  }

  private get isConnected(): boolean {
    return this.client !== null;
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
      fewShotCount: obj.fewShotCount ?? 0,
      promptSegments: obj.promptSegments ?? [],
      skillRefs: obj.skillRefs ?? [],
    };
  }

  async saveStrategy(strategy: Strategy): Promise<void> {
    if (!this.isConnected) return this.fallback.saveStrategy(strategy);

    const key = `${this.prefix}strategy:${strategy.genome.id}`;
    const memoryObj: Record<string, number> = {};
    for (const [k, v] of strategy.taskTypeMemory) memoryObj[k] = v;

    await this.client.hset(key,
      'genome', this.serializeGenome(strategy.genome),
      'fitness', String(strategy.fitness),
      'age', String(strategy.age),
      'taskTypeMemory', JSON.stringify(memoryObj),
    );

    // Also maintain fitness sorted set
    await this.client.zadd(`${this.prefix}strategy:fitness`, strategy.fitness, strategy.genome.id);
  }

  async loadStrategies(): Promise<Strategy[]> {
    if (!this.isConnected) return this.fallback.loadStrategies();

    const keys = await this.client.keys(`${this.prefix}strategy:strat_*`);
    const strategies: Strategy[] = [];

    for (const key of keys) {
      const data = await this.client.hgetall(key);
      if (data.genome) {
        const memoryObj = JSON.parse(data.taskTypeMemory || '{}');
        strategies.push({
          genome: this.deserializeGenome(data.genome),
          fitness: parseFloat(data.fitness || '0'),
          age: parseInt(data.age || '0', 10),
          taskHistory: [],
          birthWeights: null,
          taskTypeMemory: new Map(Object.entries(memoryObj)),
        });
      }
    }

    return strategies;
  }

  async recordExperience(exp: Experience): Promise<void> {
    if (!this.isConnected) return this.fallback.recordExperience(exp);

    const id = await this.client.incr(`${this.prefix}exp:counter`);
    await this.client.hset(`${this.prefix}exp:${id}`,
      'strategyId', exp.strategyId,
      'taskType', exp.taskType,
      'taskPrompt', exp.taskPrompt,
      'response', exp.response,
      'score', String(exp.score),
      'tokensUsed', String(exp.tokensUsed),
      'latencyMs', String(exp.latencyMs),
      'fitnessSignal', String(exp.fitnessSignal ?? ''),
      'userFeedback', String(exp.userFeedback ?? ''),
    );

    // Add to sorted set for score-based queries
    await this.client.zadd(`${this.prefix}exp:by_score`, exp.score, String(id));
    // Add to list for strategy-based queries
    await this.client.lpush(`${this.prefix}exp:by_strategy:${exp.strategyId}`, String(id));
  }

  async queryExperiences(filter: ExperienceFilter): Promise<Experience[]> {
    if (!this.isConnected) return this.fallback.queryExperiences(filter);

    // Simplified: get IDs from relevant index
    let ids: string[];
    if (filter.strategyId) {
      ids = await this.client.lrange(`${this.prefix}exp:by_strategy:${filter.strategyId}`, 0, (filter.limit ?? 100) - 1);
    } else {
      const counter = await this.client.get(`${this.prefix}exp:counter`) || '0';
      const max = parseInt(counter, 10);
      ids = [];
      for (let i = max; i > 0 && ids.length < (filter.limit ?? 100); i--) {
        ids.push(String(i));
      }
    }

    const experiences: Experience[] = [];
    for (const id of ids) {
      const data = await this.client.hgetall(`${this.prefix}exp:${id}`);
      if (!data.strategyId) continue;

      const exp: Experience = {
        id: parseInt(id, 10),
        strategyId: data.strategyId,
        taskType: data.taskType,
        taskPrompt: data.taskPrompt,
        response: data.response,
        score: parseFloat(data.score),
        tokensUsed: parseInt(data.tokensUsed, 10),
        latencyMs: parseInt(data.latencyMs, 10),
        fitnessSignal: data.fitnessSignal ? parseFloat(data.fitnessSignal) : undefined,
        userFeedback: data.userFeedback ? parseFloat(data.userFeedback) : undefined,
      };

      if (filter.taskType && exp.taskType !== filter.taskType) continue;
      if (filter.minScore !== undefined && exp.score < filter.minScore) continue;

      experiences.push(exp);
    }

    return experiences;
  }

  async saveSkill(skill: Skill): Promise<void> {
    if (!this.isConnected) return this.fallback.saveSkill(skill);

    await this.client.hset(`${this.prefix}skill:${skill.id}`,
      'type', skill.type,
      'taskTypes', JSON.stringify(skill.taskTypes),
      'content', skill.content,
      'fitness', String(skill.fitness),
      'uses', String(skill.uses),
      'successes', String(skill.successes),
    );
    await this.client.zadd(`${this.prefix}skill:fitness`, skill.fitness, skill.id);
  }

  async getSkills(taskType?: string): Promise<Skill[]> {
    if (!this.isConnected) return this.fallback.getSkills(taskType);

    const ids = await this.client.zrevrange(`${this.prefix}skill:fitness`, 0, -1);
    const skills: Skill[] = [];

    for (const id of ids) {
      const data = await this.client.hgetall(`${this.prefix}skill:${id}`);
      if (!data.type) continue;

      const taskTypes: string[] = JSON.parse(data.taskTypes);
      if (taskType && !taskTypes.includes(taskType)) continue;

      skills.push({
        id,
        type: data.type as 'code' | 'principle',
        taskTypes,
        content: data.content,
        fitness: parseFloat(data.fitness),
        uses: parseInt(data.uses, 10),
        successes: parseInt(data.successes, 10),
      });
    }

    return skills;
  }

  async updateSkillFitness(skillId: string, delta: number): Promise<void> {
    if (!this.isConnected) return this.fallback.updateSkillFitness(skillId, delta);

    await this.client.hincrbyfloat(`${this.prefix}skill:${skillId}`, 'fitness', delta);
    await this.client.hincrby(`${this.prefix}skill:${skillId}`, 'uses', 1);
    if (delta > 0) {
      await this.client.hincrby(`${this.prefix}skill:${skillId}`, 'successes', 1);
    }
    const newFitness = await this.client.hget(`${this.prefix}skill:${skillId}`, 'fitness');
    await this.client.zadd(`${this.prefix}skill:fitness`, parseFloat(newFitness), skillId);
  }

  async pruneSkills(minFitness: number): Promise<number> {
    if (!this.isConnected) return this.fallback.pruneSkills(minFitness);

    const ids = await this.client.zrangebyscore(`${this.prefix}skill:fitness`, '-inf', minFitness);
    for (const id of ids) {
      await this.client.del(`${this.prefix}skill:${id}`);
      await this.client.zrem(`${this.prefix}skill:fitness`, id);
    }
    return ids.length;
  }

  async saveGrid(grid: MapElitesCell[]): Promise<void> {
    if (!this.isConnected) return this.fallback.saveGrid(grid);

    const key = `${this.prefix}grid`;
    await this.client.del(key);
    for (let i = 0; i < grid.length; i++) {
      await this.client.hset(key, String(i),
        JSON.stringify({ genome: this.serializeGenome(grid[i].genome), fitness: grid[i].fitness }),
      );
    }
  }

  async loadGrid(): Promise<MapElitesCell[] | null> {
    if (!this.isConnected) return this.fallback.loadGrid();

    const data = await this.client.hgetall(`${this.prefix}grid`);
    if (!data || Object.keys(data).length === 0) return null;

    const cells: MapElitesCell[] = [];
    for (const [, value] of Object.entries(data)) {
      const parsed = JSON.parse(value as string);
      cells.push({
        genome: this.deserializeGenome(parsed.genome),
        fitness: parsed.fitness,
      });
    }
    return cells;
  }

  async saveMetadata(key: string, value: string): Promise<void> {
    if (!this.isConnected) return this.fallback.saveMetadata(key, value);
    await this.client.hset(`${this.prefix}metadata`, key, value);
  }

  async loadMetadata(key: string): Promise<string | null> {
    if (!this.isConnected) return this.fallback.loadMetadata(key);
    return this.client.hget(`${this.prefix}metadata`, key) ?? null;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }
}
