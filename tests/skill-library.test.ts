import { describe, it, expect, beforeEach } from 'vitest';
import { SkillLibrary, resetSkillCounter } from '../src/skills/skill-library.js';
import { MemoryStore } from '../src/storage/memory-store.js';

describe('SkillLibrary', () => {
  let library: SkillLibrary;
  let store: MemoryStore;

  beforeEach(() => {
    resetSkillCounter();
    store = new MemoryStore();
    library = new SkillLibrary(store);
  });

  it('adds a skill', async () => {
    const skill = await library.addSkill('principle', ['math'], 'Be precise with numbers.');
    expect(skill.id).toBe('skill_1');
    expect(skill.type).toBe('principle');
    expect(skill.taskTypes).toEqual(['math']);
    expect(skill.fitness).toBe(0.5);
  });

  it('retrieves skills for a task type', async () => {
    await library.addSkill('principle', ['math'], 'Be precise.');
    await library.addSkill('code', ['code'], 'Use functions.');
    await library.addSkill('principle', ['math', 'code'], 'Think step by step.');

    const mathSkills = await library.getSkillsForTask('math');
    expect(mathSkills.length).toBe(2);
  });

  it('returns skills sorted by fitness', async () => {
    await library.addSkill('principle', ['math'], 'Low fitness.', 0.3);
    await library.addSkill('principle', ['math'], 'High fitness.', 0.9);
    await library.addSkill('principle', ['math'], 'Mid fitness.', 0.6);

    const skills = await library.getSkillsForTask('math');
    expect(skills[0].fitness).toBe(0.9);
    expect(skills[1].fitness).toBe(0.6);
    expect(skills[2].fitness).toBe(0.3);
  });

  it('limits returned skills count', async () => {
    for (let i = 0; i < 10; i++) {
      await library.addSkill('principle', ['math'], `Skill ${i}`);
    }
    const skills = await library.getSkillsForTask('math', 3);
    expect(skills.length).toBe(3);
  });

  it('updates skill fitness based on score', async () => {
    const skill = await library.addSkill('principle', ['math'], 'Test.', 0.5);
    await library.updateSkillFitness(skill.id, 0.9); // good score → positive delta

    const skills = await library.getAllSkills();
    expect(skills[0].fitness).toBeGreaterThan(0.5);
  });

  it('decays all skills', async () => {
    await library.addSkill('principle', ['math'], 'A', 0.8);
    await library.addSkill('code', ['code'], 'B', 0.6);

    await library.decaySkills(0.9);

    const skills = await library.getAllSkills();
    for (const s of skills) {
      expect(s.fitness).toBeLessThan(0.8);
    }
  });

  it('prunes low-fitness skills', async () => {
    await library.addSkill('principle', ['math'], 'Good', 0.8);
    await library.addSkill('principle', ['math'], 'Bad', 0.05);

    const pruned = await library.pruneSkills(0.1);
    expect(pruned).toBe(1);

    const remaining = await library.getAllSkills();
    expect(remaining.length).toBe(1);
    expect(remaining[0].content).toBe('Good');
  });

  it('adds skill with custom initial fitness', async () => {
    const skill = await library.addSkill('code', ['code'], 'Pattern', 0.9);
    expect(skill.fitness).toBe(0.9);
  });

  it('returns empty array for unknown task type', async () => {
    await library.addSkill('principle', ['math'], 'Math only.');
    const skills = await library.getSkillsForTask('unknown');
    expect(skills.length).toBe(0);
  });

  it('getAllSkills returns everything', async () => {
    await library.addSkill('principle', ['math'], 'A');
    await library.addSkill('code', ['code'], 'B');
    await library.addSkill('principle', ['writing'], 'C');

    const all = await library.getAllSkills();
    expect(all.length).toBe(3);
  });
});
