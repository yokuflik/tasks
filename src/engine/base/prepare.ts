import { GRID_MINUTES } from '../../contracts';
import type {
  BlockedTime,
  Category,
  ExceptionsReport,
  ScheduleBlock,
  Settings,
  Task,
  UnplacedTask,
  Week,
} from '../../contracts';
import { dayDiff } from './dates';
import { analyzeTasks, isFixedTask, suggestionFor } from './feasibility';
import { absToRange, buildGrid, isRangeFree, occupy, OCCUPANT, rangeToAbs } from './grid';
import type { Grid } from './grid';
import { nightWindow, planSleep } from './sleep';

export interface PrepareInput {
  week: Pick<Week, 'startDate' | 'activeDates' | 'dayWindows' | 'blockedTimes'>;
  tasks: readonly Task[];
  categories: readonly Category[];
  settings: Pick<Settings, 'minSleepMin' | 'targetSleepMin'>;
  /** בלוקים נעולים ידנית (כולל שינה נעולה): המנוע לא נוגע בהם. */
  lockedBlocks?: readonly ScheduleBlock[];
}

/** התראה: לילה שבו חובות (עבודה, רופאים) או זמן חסום מונעים את מינימום השינה. */
export interface SleepWarning {
  date: string;
  availableMin: number;
  requiredMin: number;
  /** חובות קבועות שנוגעות בלילה. */
  mandatoryTaskIds: string[];
  blockedTimeIds: string[];
  message: string;
}

/** תוצאת חלק א: הבסיס שעליו P4 משבץ את שאר המשימות. */
export interface PreparedWeek {
  grid: Grid;
  /** משמרות ושאר המשימות הקבועות, במקומן המדויק. */
  fixedBlocks: ScheduleBlock[];
  sleepBlocks: ScheduleBlock[];
  /** משימות גמישות שאפשר לשבץ (לא נכשלו בבדיקות הבסיס). */
  schedulable: Task[];
  /** מקביל ל-sleepShortfalls, עם הגורמים והודעה בעברית להצגה למשתמש. */
  sleepWarnings: SleepWarning[];
  exceptions: ExceptionsReport;
}

/** נסיעה לפני ואחרי משמרת עבודה. */
export const TRAVEL_MIN = 20;
/** מרווח מינימלי בין הנסיעה למשימה הסמוכה, כדי שלא תיראה צמודה לקצה שלה. */
export const TRAVEL_GAP_MIN = 10;

/** נסיעה לכל כיוון (דקות): עבודה תמיד 20, אחרת לפי המשימה. */
export function travelOf(task: Pick<Task, 'categoryId' | 'travelMin'>): number {
  return task.categoryId === 'work' ? TRAVEL_MIN : Math.max(0, task.travelMin ?? 0);
}

function fixedConflict(taskId: string, why: string): UnplacedTask {
  return { taskId, reason: 'fixed_conflict', suggestion: `${suggestionFor('fixed_conflict')} (${why})` };
}

/**
 * חלק א של המנוע, לפי הסדר מהתכנון:
 * 1. רשת 15 דקות לפי חלונות הפעילות. 2. זמנים חסומים ובלוקים נעולים. 3. משמרות ומשימות קבועות
 * במקומן. 4. שינה רציפה בכל לילה. 5. בדיקת יכולת שיבוץ לכל משימה גמישה ודוח חריגים.
 * שבתות וחגים אינם קלט: הם סימון בלבד ואינם משפיעים כאן.
 */
export function prepareWeek(input: PrepareInput): PreparedWeek {
  const { week, tasks, categories, settings } = input;
  const grid = buildGrid(week);
  const lockedBlocks = input.lockedBlocks ?? [];
  const unplaced: UnplacedTask[] = [];

  const blocked: BlockedTime[] = [...week.blockedTimes];
  for (const b of blocked) {
    const r = rangeToAbs(grid, b.range);
    occupy(grid, r.start, r.end, OCCUPANT.blocked);
  }
  for (const b of lockedBlocks) {
    const r = rangeToAbs(grid, b.range);
    occupy(grid, r.start, r.end, OCCUPANT.locked);
  }

  const busyRanges = [
    ...blocked.map((b) => ({ id: b.id, ...rangeToAbs(grid, b.range) })),
    ...lockedBlocks.map((b) => ({ id: b.id, ...rangeToAbs(grid, b.range) })),
  ];
  const fixedBlocks: ScheduleBlock[] = [];
  const placedFixed: { id: string; start: number; end: number }[] = [];
  const live = tasks.filter((t) => t.status !== 'done');
  const fixedTasks: { task: Task; start: number; end: number }[] = [];
  for (const task of live.filter((t) => isFixedTask(t, categories))) {
    const { fixedDate, fixedStartMin } = task.constraints;
    if (fixedDate === undefined || fixedStartMin === undefined) {
      unplaced.push(fixedConflict(task.id, 'חסרים יום או שעת התחלה'));
      continue;
    }
    const idx = dayDiff(week.startDate, fixedDate);
    if (!week.activeDates.includes(fixedDate) || idx < 0 || idx >= grid.dayCount || fixedStartMin < 0 || fixedStartMin >= 1440) {
      unplaced.push(fixedConflict(task.id, 'היום אינו ביום פעיל בשבוע'));
      continue;
    }
    const start = idx * 1440 + fixedStartMin;
    fixedTasks.push({ task, start, end: start + task.durationMin });
  }
  fixedTasks.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const f of fixedTasks) {
    const hit =
      busyRanges.find((r) => r.start < f.end && r.end > f.start) ??
      placedFixed.find((r) => r.start < f.end && r.end > f.start);
    if (hit) {
      unplaced.push(fixedConflict(f.task.id, `חופף ל-${hit.id}`));
      continue;
    }
    placedFixed.push({ id: f.task.id, start: f.start, end: f.end });
    occupy(grid, f.start, f.end, OCCUPANT.fixed);
    fixedBlocks.push({
      id: `fixed-${f.task.id}`,
      kind: 'task',
      taskId: f.task.id,
      range: absToRange(grid, f.start, f.end),
      locked: false,
    });
  }

  // נסיעה של 20 דקות לפני ואחרי כל משמרת עבודה. תופסת רק זמן פנוי.
  const morningStarts: number[] = [];
  for (const f of placedFixed) {
    const task = live.find((t) => t.id === f.id);
    if (!task || task.categoryId !== 'work') continue;
    const reserve = TRAVEL_MIN + TRAVEL_GAP_MIN;
    const before = isRangeFree(grid, f.start - reserve, f.start, { ignoreOpen: true }) ? reserve : TRAVEL_MIN;
    const after = isRangeFree(grid, f.end, f.end + reserve, { ignoreOpen: true }) ? reserve : TRAVEL_MIN;
    for (const [a, b] of [[f.start - before, f.start], [f.end, f.end + after]] as const) {
      if (isRangeFree(grid, a, b, { ignoreOpen: true })) occupy(grid, a, b, OCCUPANT.fixed);
    }
    // הרשת בקפיצות 15 דקות, אז השינה נגמרת על גבול המשבצת, לפני הנסיעה והמרווח
    morningStarts.push(Math.floor((f.start - before) / GRID_MINUTES) * GRID_MINUTES);
  }

  const sleep = planSleep(grid, week.activeDates, settings, lockedBlocks, morningStarts);

  const flexible = live.filter((t) => !isFixedTask(t, categories));
  const analysis = analyzeTasks(grid, live, categories, unplaced);
  const failedIds = new Set(analysis.map((u) => u.taskId));
  unplaced.push(...analysis);

  const sleepWarnings: SleepWarning[] = sleep.shortfalls.map((sf) => {
    const win = nightWindow(grid, sf.date);
    const from = win.startAbs;
    const to = win.endAbs + sf.requiredMin;
    const mandatoryTaskIds = placedFixed.filter((r) => r.start < to && r.end > from).map((r) => r.id);
    const blockedTimeIds = blocked
      .filter((b) => {
        const r = rangeToAbs(grid, b.range);
        return r.start < to && r.end > from;
      })
      .map((b) => b.id);
    const hours = (sf.availableMin / 60).toFixed(1).replace(/\.0$/, '');
    return {
      ...sf,
      mandatoryTaskIds,
      blockedTimeIds,
      message: `בלילה שאחרי ${sf.date} יוצאות רק ${hours} שעות שינה רצופות במקום ${sf.requiredMin / 60}, בגלל חובות קבועות (עבודה או תורים).`,
    };
  });

  return {
    grid,
    fixedBlocks,
    sleepBlocks: sleep.blocks,
    schedulable: flexible.filter((t) => !failedIds.has(t.id)),
    sleepWarnings,
    exceptions: { unplaced, sleepShortfalls: sleep.shortfalls },
  };
}
