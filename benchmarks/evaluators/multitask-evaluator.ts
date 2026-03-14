// ================================================================
//  Multi-Task Evaluator — 5 diverse task types for specialization
//
//  Types: coding, research, analysis, creative, summarization
//  All procedurally generated from seeded RNG, all objectively scored.
//  score() returns fuzzy 0..1 (for evolution gradient).
//  scoreById() returns binary 0/1 (for final accuracy reporting).
// ================================================================

import type { Task, TaskEvaluator } from '../../src/core/types.js';
import { createSeededRng } from '../harness.js';

export type MultitaskType = 'coding' | 'research' | 'analysis' | 'creative' | 'summarization';
const TASK_TYPES: MultitaskType[] = ['coding', 'research', 'analysis', 'creative', 'summarization'];

// ── Data Pools ──────────────────────────────────────────────────

const CAPITALS = [
  ['France', 'Paris'], ['Japan', 'Tokyo'], ['Brazil', 'Brasilia'], ['Egypt', 'Cairo'],
  ['Canada', 'Ottawa'], ['Australia', 'Canberra'], ['Germany', 'Berlin'], ['Italy', 'Rome'],
  ['Mexico', 'Mexico City'], ['India', 'New Delhi'], ['Argentina', 'Buenos Aires'],
  ['Thailand', 'Bangkok'], ['Poland', 'Warsaw'], ['Turkey', 'Ankara'], ['Sweden', 'Stockholm'],
  ['Norway', 'Oslo'], ['Portugal', 'Lisbon'], ['Greece', 'Athens'], ['Kenya', 'Nairobi'],
  ['Peru', 'Lima'], ['Chile', 'Santiago'], ['Colombia', 'Bogota'], ['Cuba', 'Havana'],
  ['Morocco', 'Rabat'], ['Ukraine', 'Kyiv'], ['Vietnam', 'Hanoi'], ['Malaysia', 'Kuala Lumpur'],
  ['Philippines', 'Manila'], ['Nigeria', 'Abuja'], ['South Korea', 'Seoul'],
  ['Switzerland', 'Bern'], ['Austria', 'Vienna'], ['Belgium', 'Brussels'], ['Denmark', 'Copenhagen'],
  ['Finland', 'Helsinki'], ['Ireland', 'Dublin'], ['Netherlands', 'Amsterdam'],
  ['New Zealand', 'Wellington'], ['Czech Republic', 'Prague'], ['Hungary', 'Budapest'],
  ['Romania', 'Bucharest'], ['Croatia', 'Zagreb'], ['Serbia', 'Belgrade'],
  ['Bulgaria', 'Sofia'], ['Slovakia', 'Bratislava'], ['Lithuania', 'Vilnius'],
  ['Latvia', 'Riga'], ['Estonia', 'Tallinn'], ['Iceland', 'Reykjavik'], ['Luxembourg', 'Luxembourg City'],
] as const;

const ELEMENTS = [
  ['Hydrogen', 'H'], ['Helium', 'He'], ['Lithium', 'Li'], ['Carbon', 'C'], ['Nitrogen', 'N'],
  ['Oxygen', 'O'], ['Fluorine', 'F'], ['Neon', 'Ne'], ['Sodium', 'Na'], ['Magnesium', 'Mg'],
  ['Aluminum', 'Al'], ['Silicon', 'Si'], ['Phosphorus', 'P'], ['Sulfur', 'S'], ['Chlorine', 'Cl'],
  ['Potassium', 'K'], ['Calcium', 'Ca'], ['Iron', 'Fe'], ['Copper', 'Cu'], ['Zinc', 'Zn'],
  ['Silver', 'Ag'], ['Tin', 'Sn'], ['Gold', 'Au'], ['Mercury', 'Hg'], ['Lead', 'Pb'],
  ['Titanium', 'Ti'], ['Chromium', 'Cr'], ['Manganese', 'Mn'], ['Nickel', 'Ni'], ['Cobalt', 'Co'],
  ['Arsenic', 'As'], ['Selenium', 'Se'], ['Bromine', 'Br'], ['Krypton', 'Kr'], ['Rubidium', 'Rb'],
  ['Strontium', 'Sr'], ['Zirconium', 'Zr'], ['Molybdenum', 'Mo'], ['Palladium', 'Pd'],
  ['Iodine', 'I'], ['Cesium', 'Cs'], ['Barium', 'Ba'], ['Tungsten', 'W'], ['Platinum', 'Pt'],
  ['Radon', 'Rn'], ['Uranium', 'U'], ['Plutonium', 'Pu'], ['Xenon', 'Xe'],
  ['Argon', 'Ar'], ['Boron', 'B'],
] as const;

const UNIT_CONVERSIONS = [
  ['kilometers', 'miles', 1, 0.621371], ['meters', 'feet', 1, 3.28084],
  ['kilograms', 'pounds', 1, 2.20462], ['liters', 'gallons', 1, 0.264172],
  ['Celsius', 'Fahrenheit', 100, 212], ['centimeters', 'inches', 1, 0.393701],
  ['kilometers per hour', 'miles per hour', 100, 62.1371],
  ['grams', 'ounces', 100, 3.5274], ['meters', 'yards', 1, 1.09361],
  ['milliliters', 'fluid ounces', 100, 3.3814],
  ['hectares', 'acres', 1, 2.47105], ['kilojoules', 'calories', 1, 0.239006],
  ['Celsius', 'Fahrenheit', 0, 32], ['Celsius', 'Fahrenheit', 37, 98.6],
  ['kilometers', 'miles', 10, 6.21371], ['kilograms', 'pounds', 10, 22.0462],
  ['liters', 'gallons', 10, 2.64172], ['meters', 'feet', 10, 32.8084],
  ['centimeters', 'inches', 100, 39.3701], ['grams', 'ounces', 1000, 35.274],
] as const;

const CREATIVE_TOPICS = [
  'the ocean', 'a sunset', 'an old library', 'a rainy day', 'a mountain peak',
  'a busy market', 'winter snow', 'a forest path', 'the night sky', 'a cup of tea',
  'a distant memory', 'a train journey', 'city lights', 'spring flowers', 'a lighthouse',
  'desert sand', 'a child playing', 'morning fog', 'a quiet river', 'autumn leaves',
] as const;

const ENTITY_NAMES = [
  'Alice Johnson', 'Bob Smith', 'Carlos Rivera', 'Diana Chen', 'Emil Novak',
  'Fiona O\'Brien', 'Gavin Patel', 'Hannah Kim', 'Ivan Petrov', 'Julia Santos',
  'Kevin Wright', 'Laura Fischer', 'Marco Rossi', 'Nina Tanaka', 'Oscar Larsson',
  'Patricia Gomez', 'Quentin Dubois', 'Rachel Cohen', 'Stefan Muller', 'Tanya Ivanova',
] as const;

const COMPANIES = [
  'TechCorp', 'GlobalFin', 'MediHealth', 'EcoGreen', 'DataStream',
  'CloudBase', 'NetPrime', 'BioGen', 'AeroStar', 'QuantumBit',
  'SolarTech', 'CyberLabs', 'NovaTrade', 'AlphaCore', 'BluePeak',
  'OceanNet', 'PrimeLogic', 'VectorAI', 'ZenithSoft', 'ApexMedia',
] as const;

const ROLES = [
  'Software Engineer', 'Data Analyst', 'Product Manager', 'UX Designer',
  'Marketing Director', 'CFO', 'Research Scientist', 'Sales Lead',
  'DevOps Engineer', 'HR Manager', 'CTO', 'Business Analyst',
  'Quality Assurance Lead', 'Operations Manager', 'Security Architect',
  'Frontend Developer', 'Backend Developer', 'Machine Learning Engineer',
  'Project Coordinator', 'Content Strategist',
] as const;

const CITIES = [
  'San Francisco', 'London', 'Tokyo', 'Berlin', 'Sydney',
  'Toronto', 'Singapore', 'Amsterdam', 'Seoul', 'Mumbai',
  'Dublin', 'Stockholm', 'Zurich', 'Barcelona', 'Austin',
  'Chicago', 'Melbourne', 'Oslo', 'Copenhagen', 'Lisbon',
] as const;

// Logic template pools
const ANIMALS = [
  'dogs', 'cats', 'birds', 'fish', 'rabbits', 'horses', 'wolves',
  'bears', 'eagles', 'dolphins', 'tigers', 'elephants', 'penguins',
  'snakes', 'owls', 'foxes', 'deer', 'whales', 'hawks', 'otters',
] as const;

const PROPERTIES = [
  'have fur', 'can swim', 'are warm-blooded', 'lay eggs', 'can fly',
  'have teeth', 'are herbivores', 'are nocturnal', 'have tails', 'are carnivores',
  'have claws', 'are social', 'are fast', 'have scales', 'are intelligent',
  'have feathers', 'are aquatic', 'are terrestrial', 'are omnivores', 'have horns',
] as const;

const CATEGORIES = [
  'mammals', 'reptiles', 'amphibians', 'insects', 'vertebrates',
  'predators', 'prey animals', 'domestic animals', 'wild animals', 'endangered species',
  'marine animals', 'land animals', 'flying animals', 'pack animals', 'solitary animals',
  'herbivores', 'carnivores', 'omnivores', 'nocturnal animals', 'diurnal animals',
] as const;

// ── Item types ──────────────────────────────────────────────────

interface MultitaskItem {
  id: string;
  type: MultitaskType;
  prompt: string;
  difficulty: number;
}

interface CodingMeta { answer: number }
interface ResearchMeta { answer: string }
interface AnalysisMeta { answer: 'yes' | 'no' }
interface CreativeMeta { targetWordCount: number }
interface SummarizationMeta { expected: Record<string, string | number> }

type ItemMeta = CodingMeta | ResearchMeta | AnalysisMeta | CreativeMeta | SummarizationMeta;

// ── Generators ──────────────────────────────────────────────────

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function generateCodingTask(rng: () => number): { prompt: string; meta: CodingMeta } {
  // Arithmetic programs — "What does this code output?"
  const variant = Math.floor(rng() * 4);
  let code: string;
  let answer: number;

  if (variant === 0) {
    // Simple accumulator loop
    const n = 3 + Math.floor(rng() * 8);
    const step = 1 + Math.floor(rng() * 5);
    let total = 0;
    for (let i = 0; i < n; i++) total += i * step;
    code = `x = 0\nfor i in range(${n}):\n    x += i * ${step}\nprint(x)`;
    answer = total;
  } else if (variant === 1) {
    // Conditional accumulation
    const n = 5 + Math.floor(rng() * 10);
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) total += i;
      else total -= 1;
    }
    code = `x = 0\nfor i in range(${n}):\n    if i % 2 == 0:\n        x += i\n    else:\n        x -= 1\nprint(x)`;
    answer = total;
  } else if (variant === 2) {
    // Nested computation
    const a = 2 + Math.floor(rng() * 8);
    const b = 1 + Math.floor(rng() * 5);
    const c = 1 + Math.floor(rng() * 4);
    answer = (a + b) * c - b;
    code = `a = ${a}\nb = ${b}\nc = ${c}\nresult = (a + b) * c - b\nprint(result)`;
  } else {
    // List operation
    const n = 3 + Math.floor(rng() * 5);
    const nums: number[] = [];
    for (let i = 0; i < n; i++) nums.push(1 + Math.floor(rng() * 20));
    answer = nums.reduce((s, v) => s + v, 0);
    code = `nums = [${nums.join(', ')}]\nprint(sum(nums))`;
  }

  return {
    prompt: `What does this Python code output? Reply with only the number.\n\n${code}`,
    meta: { answer },
  };
}

function generateResearchTask(
  rng: () => number,
  pool: { capitals: typeof CAPITALS[number][]; elements: typeof ELEMENTS[number][]; conversions: typeof UNIT_CONVERSIONS[number][] },
): { prompt: string; meta: ResearchMeta } {
  const variant = Math.floor(rng() * 3);

  if (variant === 0) {
    // Capital question
    const [country, capital] = pick(pool.capitals, rng);
    return {
      prompt: `What is the capital of ${country}? Reply with only the city name.`,
      meta: { answer: capital },
    };
  } else if (variant === 1) {
    // Element symbol
    const [element, symbol] = pick(pool.elements, rng);
    return {
      prompt: `What is the chemical symbol for ${element}? Reply with only the symbol.`,
      meta: { answer: symbol },
    };
  } else {
    // Unit conversion
    const [fromUnit, toUnit, fromVal, toVal] = pick(pool.conversions, rng);
    return {
      prompt: `Convert ${fromVal} ${fromUnit} to ${toUnit}. Reply with only the number (round to 1 decimal place if needed).`,
      meta: { answer: String(Math.round(toVal * 10) / 10) },
    };
  }
}

function generateAnalysisTask(
  rng: () => number,
  animalPool: readonly string[],
  propertyPool: readonly string[],
  categoryPool: readonly string[],
): { prompt: string; meta: AnalysisMeta } {
  const variant = Math.floor(rng() * 4);

  if (variant === 0) {
    // Valid syllogism: All A are B. All B are C. Is any A a C? → yes
    const a = pick(animalPool, rng);
    const b = pick(categoryPool, rng);
    const c = pick(propertyPool, rng);
    return {
      prompt: `All ${a} are ${b}. All ${b} ${c}. Do ${a} ${c}? Answer only yes or no.`,
      meta: { answer: 'yes' },
    };
  } else if (variant === 1) {
    // Negation: No A are B. X is an A. Is X a B? → no
    const a = pick(categoryPool, rng);
    const b = pick(propertyPool, rng);
    return {
      prompt: `No ${a} ${b}. A creature is a member of ${a}. Does this creature ${b.replace(/^(are|have|can) /, '')}? Answer only yes or no.`,
      meta: { answer: 'no' },
    };
  } else if (variant === 2) {
    // Contrapositive: If A then B. Not B. Is A true? → no
    const a = pick(propertyPool, rng);
    const b = pick(propertyPool, rng);
    if (a === b) {
      // Fallback to simple
      return {
        prompt: `If an animal ${a}, then it is special. An animal is not special. Does this animal ${a.replace(/^(are|have|can) /, '')}? Answer only yes or no.`,
        meta: { answer: 'no' },
      };
    }
    return {
      prompt: `If an animal can ${a.replace(/^(are|have|can) /, '')}, then it can ${b.replace(/^(are|have|can) /, '')}. An animal cannot ${b.replace(/^(are|have|can) /, '')}. Can this animal ${a.replace(/^(are|have|can) /, '')}? Answer only yes or no.`,
      meta: { answer: 'no' },
    };
  } else {
    // Chain: All A are B. All B are C. No C are D. Is any A a D? → no
    const a = pick(animalPool, rng);
    const b = pick(categoryPool, rng);
    const c = pick(categoryPool, rng);
    const d = pick(propertyPool, rng);
    if (b === c) {
      return {
        prompt: `All ${a} are ${b}. No ${b} ${d}. Do any ${a} ${d}? Answer only yes or no.`,
        meta: { answer: 'no' },
      };
    }
    return {
      prompt: `All ${a} are ${b}. All ${b} are ${c}. No ${c} ${d}. Do any ${a} ${d}? Answer only yes or no.`,
      meta: { answer: 'no' },
    };
  }
}

function generateCreativeTask(
  rng: () => number,
  topicPool: readonly string[],
): { prompt: string; meta: CreativeMeta } {
  const topic = pick(topicPool, rng);
  const targetWordCount = 10 + Math.floor(rng() * 41); // 10–50 words
  return {
    prompt: `Write exactly ${targetWordCount} words about ${topic}. Count carefully — the response must contain exactly ${targetWordCount} words.`,
    meta: { targetWordCount },
  };
}

function generateSummarizationTask(
  rng: () => number,
  namePool: readonly string[],
  companyPool: readonly string[],
  rolePool: readonly string[],
  cityPool: readonly string[],
): { prompt: string; meta: SummarizationMeta } {
  const name = pick(namePool, rng);
  const company = pick(companyPool, rng);
  const role = pick(rolePool, rng);
  const city = pick(cityPool, rng);
  const age = 25 + Math.floor(rng() * 35);

  const text = `${name}, age ${age}, works at ${company} as a ${role} in ${city}.`;
  const expected: Record<string, string | number> = { name, age, company, role, city };

  const fieldList = Object.keys(expected).join(', ');
  return {
    prompt: `Extract the following fields as JSON: ${fieldList}.\n\nInput: "${text}"\n\nReply with only the JSON object.`,
    meta: { expected },
  };
}

// ── Scoring ─────────────────────────────────────────────────────

function scoreCoding(response: string, expected: number): number {
  const match = response.match(/-?\d+\.?\d*/);
  if (!match) return 0;
  const answer = parseFloat(match[0]);
  if (isNaN(answer)) return 0;

  if (Math.abs(expected) < 0.001) {
    return Math.abs(answer) < 0.01 ? 1.0 : Math.max(0, 1 - Math.abs(answer));
  }

  const relError = Math.abs((answer - expected) / expected);
  if (relError < 0.001) return 1.0;
  if (relError < 0.01) return 0.9;
  if (relError < 0.05) return 0.7;
  if (relError < 0.1) return 0.5;
  if (relError < 0.3) return 0.2;
  return 0;
}

function scoreResearch(response: string, expected: string): number {
  const cleaned = response.trim().toLowerCase();
  const target = expected.trim().toLowerCase();

  // Exact match
  if (cleaned === target) return 1.0;
  // Contains the answer
  if (cleaned.includes(target)) return 0.9;

  // For numeric answers (unit conversions), try numeric comparison
  const respNum = parseFloat(cleaned.replace(/[^0-9.\-]/g, ''));
  const expNum = parseFloat(target);
  if (!isNaN(respNum) && !isNaN(expNum)) {
    if (Math.abs(expNum) < 0.001) {
      return Math.abs(respNum) < 0.1 ? 1.0 : 0;
    }
    const relError = Math.abs((respNum - expNum) / expNum);
    if (relError < 0.01) return 1.0;
    if (relError < 0.05) return 0.8;
    if (relError < 0.1) return 0.5;
    return 0;
  }

  return 0;
}

function scoreAnalysis(response: string, expected: 'yes' | 'no'): number {
  const lower = response.toLowerCase().trim();
  const hasYes = /\byes\b/.test(lower);
  const hasNo = /\bno\b/.test(lower);

  if (expected === 'yes' && hasYes && !hasNo) return 1.0;
  if (expected === 'no' && hasNo && !hasYes) return 1.0;
  if (hasYes && hasNo) return 0.2;
  if (expected === 'yes' && hasYes) return 0.8;
  if (expected === 'no' && hasNo) return 0.8;
  return 0;
}

function scoreCreative(response: string, targetWordCount: number): number {
  const words = response.trim().split(/\s+/).filter(w => w.length > 0);
  const count = words.length;
  const diff = Math.abs(count - targetWordCount);

  if (diff === 0) return 1.0;
  if (diff <= 1) return 0.9;
  if (diff <= 3) return 0.7;
  if (diff <= 5) return 0.5;
  if (diff <= 10) return 0.3;
  return 0.1;
}

function scoreSummarization(response: string, expected: Record<string, string | number>): number {
  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = response.match(/\{[^{}]*\}/);
    if (!jsonMatch) return 0;
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return 0;
  }

  // Valid JSON: 0.3 base score
  const fieldKeys = Object.keys(expected);
  const fieldWeight = 0.7 / fieldKeys.length;
  let fieldScore = 0;

  for (const key of fieldKeys) {
    const expectedVal = expected[key];
    const actualVal = parsed[key];
    if (actualVal === undefined || actualVal === null) continue;

    if (typeof expectedVal === 'number') {
      if (Number(actualVal) === expectedVal) fieldScore += fieldWeight;
    } else {
      const expectedStr = String(expectedVal).toLowerCase().trim();
      const actualStr = String(actualVal).toLowerCase().trim();
      if (actualStr === expectedStr) fieldScore += fieldWeight;
    }
  }

  return 0.3 + fieldScore;
}

// ── MultitaskEvaluator ──────────────────────────────────────────

export class MultitaskEvaluator implements TaskEvaluator {
  private items: MultitaskItem[] = [];
  private metaMap = new Map<string, ItemMeta>();
  private pointer = 0;

  constructor(mode: 'train' | 'eval', baseSeed = 42) {
    const seed = mode === 'eval' ? baseSeed + 10000 : baseSeed;
    const rng = createSeededRng(seed);

    // Split data pools by mode (train=first half, eval=second half)
    const half = <T>(arr: readonly T[]): T[] => {
      const mid = Math.floor(arr.length / 2);
      return mode === 'train'
        ? (arr.slice(0, mid) as T[])
        : (arr.slice(mid) as T[]);
    };

    const capitals = half(CAPITALS);
    const elements = half(ELEMENTS);
    const conversions = half(UNIT_CONVERSIONS);
    const topics = half(CREATIVE_TOPICS);
    const names = half(ENTITY_NAMES);
    const companies = half(COMPANIES);
    const roles = half(ROLES);
    const cities = half(CITIES);
    const animals = half(ANIMALS);
    const properties = half(PROPERTIES);
    const categories = half(CATEGORIES);

    // Generate 200 items (40 per type)
    const ITEMS_PER_TYPE = 40;
    let counter = 0;

    for (const taskType of TASK_TYPES) {
      for (let i = 0; i < ITEMS_PER_TYPE; i++) {
        const id = `mt_${mode}_${taskType}_${counter++}`;
        let prompt: string;
        let meta: ItemMeta;

        switch (taskType) {
          case 'coding': {
            const gen = generateCodingTask(rng);
            prompt = gen.prompt;
            meta = gen.meta;
            break;
          }
          case 'research': {
            const gen = generateResearchTask(rng, { capitals, elements, conversions });
            prompt = gen.prompt;
            meta = gen.meta;
            break;
          }
          case 'analysis': {
            const gen = generateAnalysisTask(rng, animals, properties, categories);
            prompt = gen.prompt;
            meta = gen.meta;
            break;
          }
          case 'creative': {
            const gen = generateCreativeTask(rng, topics);
            prompt = gen.prompt;
            meta = gen.meta;
            break;
          }
          case 'summarization': {
            const gen = generateSummarizationTask(rng, names, companies, roles, cities);
            prompt = gen.prompt;
            meta = gen.meta;
            break;
          }
        }

        this.metaMap.set(id, meta);
        this.items.push({
          id,
          type: taskType,
          prompt,
          difficulty: 0.5,
        });
      }
    }
  }

  /** For Ecology evolution cycles */
  generateTasks(count: number): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.items[this.pointer % this.items.length];
      this.pointer++;
      tasks.push({
        id: item.id,
        type: item.type,
        prompt: item.prompt,
        difficulty: item.difficulty,
        metadata: { taskType: item.type },
      });
    }
    return tasks;
  }

  /** Get all items for direct eval iteration */
  getAllItems(): MultitaskItem[] {
    return [...this.items];
  }

  /** Fuzzy 0..1 scoring for evolution gradient */
  score(task: Task, response: string): number {
    return this.scoreItem(task.id, response);
  }

  /** Binary 0/1 for final accuracy reporting */
  scoreById(id: string, response: string): number {
    const fuzzy = this.scoreItem(id, response);
    return fuzzy >= 0.9 ? 1 : 0;
  }

  /** Get the task type for a given item ID */
  getItemType(id: string): MultitaskType | undefined {
    const item = this.items.find(it => it.id === id);
    return item?.type as MultitaskType | undefined;
  }

  private scoreItem(id: string, response: string): number {
    const meta = this.metaMap.get(id);
    if (!meta) return 0;

    const item = this.items.find(it => it.id === id);
    if (!item) return 0;

    switch (item.type as MultitaskType) {
      case 'coding':
        return scoreCoding(response, (meta as CodingMeta).answer);
      case 'research':
        return scoreResearch(response, (meta as ResearchMeta).answer);
      case 'analysis':
        return scoreAnalysis(response, (meta as AnalysisMeta).answer);
      case 'creative':
        return scoreCreative(response, (meta as CreativeMeta).targetWordCount);
      case 'summarization':
        return scoreSummarization(response, (meta as SummarizationMeta).expected);
      default:
        return 0;
    }
  }
}
