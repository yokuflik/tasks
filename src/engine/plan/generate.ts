import { GRID_MINUTES } from '../../contracts';
import type {
  Category,
  Id,
  Personality,
  Schedule,
  ScheduleBlock,
  Settings,
  Task,
  UnplacedTask,
  Week,
} from '../../contracts';
import { absToRange, dayDiff, isFixedTask, prepareWeek, rangeToAbs, SLOTS_PER_DAY, taskMask, travelOf } from '../base';
import type { PreparedWeek } from '../base';
import { padOf } from './slots';
import { MIN_VARIATION_DISTANCE, scheduleDistance } from './distance';
import { improve } from './improve';
import { PERSONALITIES, PERSONALITY_WEIGHTS } from './personalities';
import { greedyPlace, orderTasks, retryUnplaced } from './place';
import type { PlanState } from './place';
import { makeRng } from './rng';
import { evaluate, toBreakdown } from './score';
import { assignThemeDays } from './themes';
import type { Ctx, Piece, TaskInfo } from './types';
import { PRIORITY_WEIGHTS } from './score';

export interface GenerateInput {
  week: Pick<Week, 'id' | 'startDate' | 'activeDates' | 'dayWindows' | 'blockedTimes'>;
  tasks: readonly Task[];
  categories: readonly Category[];
  settings: Pick<Settings, 'minSleepMin' | 'targetSleepMin' | 'minBreakMin' | 'maxConsecutiveMin'>;
  /** בלוקים נעולים ידנית: נשארים במקומם והשיבוץ מסתדר סביבם. */
  lockedBlocks?: readonly ScheduleBlock[];
  /** זרע ראשוני. אותו קלט ואותו זרע נותנים אותה תוצאה בדיוק. ברירת מחדל 1. */
  seed?: number;
}

export interface VariationPair {
  a: Personality;
  b: Personality;
  distance: number;
}

export interface GeneratedSet {
  /** מאוזן, מוקדם ודחוף, נושאי יום, בסדר הזה. */
  schedules: Schedule[];
  pairs: VariationPair[];
  /** האם יש מספיק בלוקים זזים כדי שדרישת המרחק הגיונית. */
  distanceEnforced: boolean;
  seed: number;
}

/** כמה בלוקים זזים לפחות נדרשים כדי לדרוש הבדל בין הוריאציות. */
const MIN_MOVABLE_FOR_DISTANCE = 6;
const MAX_RESEEDS = 6;
const RESEED_STEP = 1000;

export interface Plan {
  prep: PreparedWeek;
  ctx: Ctx;
  /** חתיכות קבועות ונעולות בלבד; השיבוץ מוסיף עליהן. */
  pieces: Piece[];
  lockedByTask: Map<Id, { min: number; count: number }>;
}

/** הקמת הקשר השיבוץ: חלק א (P3), הקשר הציון והחתיכות שלא זזות. */
export function buildPlan(input: GenerateInput, personality: Personality): Plan {
  const { week, tasks, categories, settings } = input;
  const locked = input.lockedBlocks ?? [];
  const prep = prepareWeek({ week, tasks, categories, settings, lockedBlocks: locked });
  const grid = prep.grid;
  const live = tasks.filter((t) => t.status !== 'done');
  const info = new Map<Id, TaskInfo>(
    live.map((t) => [t.id, { task: t, category: categories.find((c) => c.id === t.categoryId), fixed: isFixedTask(t, categories) }]),
  );
  const activeDays = [...new Set(week.activeDates.map((d) => dayDiff(grid.originDate, d)))]
    .filter((d) => d >= 0 && d < grid.dayCount)
    .sort((a, b) => a - b);
  const baseFreeMin = Array.from({ length: grid.dayCount }, (_, d) => {
    let n = 0;
    for (let s = d * SLOTS_PER_DAY; s < (d + 1) * SLOTS_PER_DAY; s++) if (grid.open[s] && grid.busy[s] === 0) n++;
    return n * GRID_MINUTES;
  });
  const masks = new Map(prep.schedulable.map((t) => [t.id, taskMask(grid, t)]));
  const ctx: Ctx = {
    grid,
    settings,
    weights: PERSONALITY_WEIGHTS[personality],
    info,
    activeDays,
    baseFreeMin,
    themeDays: personality === 'themed' ? assignThemeDays(prep.schedulable, activeDays, baseFreeMin) : new Map(),
    masks,
    pads: new Map(prep.schedulable.map((t) => [t.id, padOf(travelOf(t))])),
    priorityWeight: PRIORITY_WEIGHTS,
  };

  const pieces: Piece[] = [];
  for (const b of prep.fixedBlocks) {
    const r = rangeToAbs(grid, b.range);
    pieces.push({ id: b.id, taskId: b.taskId ?? '', segment: b.segment ?? 0, occurrence: 0, start: r.start, end: r.end, movable: false });
  }
  const lockedByTask = new Map<Id, { min: number; count: number }>();
  for (const b of locked) {
    if (b.kind !== 'task' || !b.taskId || !info.has(b.taskId)) continue;
    const r = rangeToAbs(grid, b.range);
    const l = lockedByTask.get(b.taskId) ?? { min: 0, count: 0 };
    pieces.push({ id: b.id, taskId: b.taskId, segment: b.segment ?? 0, occurrence: l.count, start: r.start, end: r.end, movable: false });
    lockedByTask.set(b.taskId, { min: l.min + (r.end - r.start), count: l.count + 1 });
  }
  return { prep, ctx, pieces, lockedByTask };
}

/** שלב אחד: בונה סידור יחיד לאישיות וזרע נתונים. דטרמיניסטי. */
export function generateSchedule(input: GenerateInput, personality: Personality, seed: number): Schedule {
  const { week, tasks } = input;
  const locked = input.lockedBlocks ?? [];
  const { prep, ctx, pieces, lockedByTask } = buildPlan(input, personality);
  const grid = ctx.grid;
  const live = tasks.filter((t) => t.status !== 'done');

  const state: PlanState = { ctx, pieces, unplaced: new Map() };
  const rng = makeRng(seed);
  const ordered = orderTasks(ctx, prep.schedulable, personality);
  greedyPlace(state, ordered, lockedByTask, rng);
  improve(state, rng);
  if (state.unplaced.size > 0 && retryUnplaced(state, ordered, lockedByTask, rng)) improve(state, rng);

  const prepUnplaced = new Set(prep.exceptions.unplaced.map((u) => u.taskId));
  const extra = [...state.unplaced.values()].filter((u) => !prepUnplaced.has(u.taskId));
  const order = new Map(tasks.map((t, i) => [t.id, i]));
  const unplaced: UnplacedTask[] = [...prep.exceptions.unplaced, ...extra].sort(
    (a, b) => (order.get(a.taskId) ?? 0) - (order.get(b.taskId) ?? 0),
  );

  const generated: ScheduleBlock[] = pieces
    .filter((p) => p.movable)
    .map((p) => ({ id: p.id, kind: 'task', taskId: p.taskId, segment: p.segment, range: absToRange(grid, p.start, p.end), locked: false }));
  const blocks = [...prep.fixedBlocks, ...prep.sleepBlocks, ...locked, ...generated].sort((a, b) => {
    const ra = rangeToAbs(grid, a.range);
    const rb = rangeToAbs(grid, b.range);
    return ra.start - rb.start || ra.end - rb.end || a.id.localeCompare(b.id);
  });

  const total = live.length;
  const score = toBreakdown(evaluate(ctx, pieces), {
    placed: total - new Set(unplaced.map((u) => u.taskId)).size,
    total,
    movablePieces: generated.length,
  });
  return {
    id: `${week.id}:${personality}:${seed}`,
    personality,
    seed,
    score,
    blocks,
    exceptions: { unplaced, sleepShortfalls: prep.exceptions.sleepShortfalls },
  };
}

function pairsOf(schedules: readonly Schedule[], fixed: ReadonlySet<string>): VariationPair[] {
  const out: VariationPair[] = [];
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      out.push({
        a: schedules[i]!.personality,
        b: schedules[j]!.personality,
        distance: scheduleDistance(schedules[i]!, schedules[j]!, fixed),
      });
    }
  }
  return out;
}

/**
 * שלוש הוריאציות (DESIGN 9.4). אחרי ההפקה מודדים מרחק בין כל זוג; אם זוג קרוב מדי,
 * האישיות המאוחרת בזוג רצה מחדש עם זרע אחר (הזרע משנה רק שבירת שוויון). הזרע בפועל נשמר ב-Schedule.seed,
 * ולכן generateSchedule(input, personality, schedule.seed) משחזר את אותו סידור בדיוק.
 */
export function generateSchedules(input: GenerateInput): GeneratedSet {
  const seed = input.seed ?? 1;
  const fixed = new Set(input.tasks.filter((t) => isFixedTask(t, input.categories)).map((t) => t.id));
  const schedules = PERSONALITIES.map((p, i) => generateSchedule(input, p, seed + i));
  const movable = Math.min(...schedules.map((s) => s.blocks.filter((b) => b.kind === 'task' && b.taskId && !fixed.has(b.taskId)).length));
  const enforced = movable >= MIN_MOVABLE_FOR_DISTANCE;

  if (enforced) {
    for (let attempt = 1; attempt <= MAX_RESEEDS; attempt++) {
      const worst = pairsOf(schedules, fixed).sort((x, y) => x.distance - y.distance)[0]!;
      if (worst.distance >= MIN_VARIATION_DISTANCE) break;
      const j = PERSONALITIES.indexOf(worst.b);
      const candidate = generateSchedule(input, worst.b, seed + j + attempt * RESEED_STEP);
      const before = Math.min(...schedules.filter((_, k) => k !== j).map((s) => scheduleDistance(s, schedules[j]!, fixed)));
      const after = Math.min(...schedules.filter((_, k) => k !== j).map((s) => scheduleDistance(s, candidate, fixed)));
      if (after > before) schedules[j] = candidate;
    }
  }
  return { schedules, pairs: pairsOf(schedules, fixed), distanceEnforced: enforced, seed };
}

/** "הפק מחדש": גרסה נוספת מאותו קלט, עם זרע אחר. */
export function regenerate(input: GenerateInput, previous: GeneratedSet): GeneratedSet {
  return generateSchedules({ ...input, seed: previous.seed + 7 * RESEED_STEP * 10 });
}
