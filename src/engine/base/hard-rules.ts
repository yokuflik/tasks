import { GRID_MINUTES } from '../../contracts';
import type {
  Category,
  ExceptionsReport,
  Id,
  IsoDate,
  ScheduleBlock,
  Settings,
  Task,
  Week,
} from '../../contracts';
import { slotProblem } from './constraints';
import type { SlotProblem } from './constraints';
import { isFixedTask } from './feasibility';
import { buildGrid, rangeToAbs, toAbs } from './grid';
import { nightWindow } from './sleep';

export type ViolationKind =
  | 'block_overlap'
  | 'blocked_time_overlap'
  | 'misaligned'
  | 'unknown_task'
  | 'fixed_moved'
  | 'fixed_missing'
  | 'sleep_missing'
  | 'sleep_multiple'
  | 'outside_window'
  | 'forbidden_time'
  | 'fixed_time'
  | 'deadline'
  | 'dependency_order'
  | 'dependency_unplaced'
  | 'task_unaccounted';

export interface Violation {
  kind: ViolationKind;
  message: string;
  taskId?: Id;
  blockIds?: Id[];
  date?: IsoDate;
}

export interface ValidateInput {
  week: Pick<Week, 'startDate' | 'activeDates' | 'dayWindows' | 'blockedTimes'>;
  tasks: readonly Task[];
  categories: readonly Category[];
  settings: Pick<Settings, 'minSleepMin'>;
  blocks: readonly ScheduleBlock[];
  exceptions: ExceptionsReport;
  /** כל משימה פעילה חייבת להיות משובצת או בדוח (בדיקה לסידור מלא, לא לשלב הבסיס). */
  requireAllAccounted?: boolean;
}

const PROBLEM_KIND: Record<SlotProblem, ViolationKind> = {
  window: 'outside_window',
  weekday: 'forbidden_time',
  forbidden_window: 'forbidden_time',
  allowed_window: 'forbidden_time',
  fixed_time: 'fixed_time',
  deadline: 'deadline',
};

/**
 * בודק את החוקים הקשיחים (DESIGN 9.2) על סידור או על תוצאת שלב הבסיס. מחזיר רשימת הפרות; ריקה = תקין.
 * חוק השינה: בכל לילה של יום פעיל יש בלוק שינה אחד לפחות במינימום, או דיווח SleepShortfall ללילה הזה.
 */
export function validateHardRules(input: ValidateInput): Violation[] {
  const { week, tasks, categories, blocks, exceptions } = input;
  const grid = buildGrid(week);
  const out: Violation[] = [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const unplacedIds = new Set(exceptions.unplaced.map((u) => u.taskId));
  const abs = new Map(blocks.map((b) => [b.id, rangeToAbs(grid, b.range)]));
  const taskOf = (b: ScheduleBlock): Task | undefined => (b.taskId ? taskById.get(b.taskId) : undefined);

  // חפיפה בין בלוקים ועם זמן חסום
  const sorted = [...blocks].sort((a, b) => abs.get(a.id)!.start - abs.get(b.id)!.start);
  let reach: ScheduleBlock | undefined;
  for (const b of sorted) {
    if (reach && abs.get(reach.id)!.end > abs.get(b.id)!.start) {
      out.push({ kind: 'block_overlap', message: `${reach.id} חופף ל-${b.id}`, blockIds: [reach.id, b.id] });
    }
    if (!reach || abs.get(b.id)!.end > abs.get(reach.id)!.end) reach = b;
  }
  for (const b of blocks) {
    const r = abs.get(b.id)!;
    for (const bt of week.blockedTimes) {
      const t = rangeToAbs(grid, bt.range);
      if (r.start < t.end && r.end > t.start) {
        out.push({ kind: 'blocked_time_overlap', message: `${b.id} חופף לזמן חסום ${bt.id}`, blockIds: [b.id] });
      }
    }
  }

  // יישור לרשת (משמרות קבועות רשאיות להיות מחוץ לרשת)
  for (const b of blocks) {
    const r = abs.get(b.id)!;
    const t = taskOf(b);
    if (t && isFixedTask(t, categories)) continue;
    if (r.start % GRID_MINUTES !== 0 || r.end % GRID_MINUTES !== 0) {
      out.push({ kind: 'misaligned', message: `${b.id} אינו מיושר למשבצות של ${GRID_MINUTES} דקות`, blockIds: [b.id] });
    }
  }

  // משימות: קיום, קבועות במקומן, מגבלות, תלויות
  const byTask = new Map<Id, ScheduleBlock[]>();
  for (const b of blocks) {
    if (b.kind !== 'task') continue;
    const t = taskOf(b);
    if (!t) {
      out.push({ kind: 'unknown_task', message: `בלוק ${b.id} מצביע על משימה לא קיימת`, blockIds: [b.id] });
      continue;
    }
    byTask.set(t.id, [...(byTask.get(t.id) ?? []), b]);
  }
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const mine = byTask.get(t.id) ?? [];
    if (isFixedTask(t, categories)) {
      if (mine.length === 0) {
        if (!unplacedIds.has(t.id)) out.push({ kind: 'fixed_missing', message: `משימה קבועה ${t.id} לא משובצת ולא בדוח`, taskId: t.id });
        continue;
      }
      const { fixedDate, fixedStartMin } = t.constraints;
      const want = fixedDate !== undefined && fixedStartMin !== undefined ? toAbs(grid, fixedDate, fixedStartMin) : NaN;
      for (const b of mine) {
        const r = abs.get(b.id)!;
        if (r.start !== want || r.end !== want + t.durationMin) {
          out.push({ kind: 'fixed_moved', message: `משימה קבועה ${t.id} זזה ממקומה`, taskId: t.id, blockIds: [b.id] });
        }
      }
      continue;
    }
    if (mine.length === 0 && input.requireAllAccounted && !unplacedIds.has(t.id)) {
      out.push({ kind: 'task_unaccounted', message: `משימה ${t.id} לא משובצת ולא בדוח`, taskId: t.id });
    }
    for (const b of mine) {
      const r = abs.get(b.id)!;
      const seen = new Set<ViolationKind>();
      for (let s = Math.floor(r.start / GRID_MINUTES); s < Math.ceil(r.end / GRID_MINUTES); s++) {
        const p = slotProblem(grid, t, s);
        if (p && !seen.has(PROBLEM_KIND[p])) {
          seen.add(PROBLEM_KIND[p]);
          out.push({ kind: PROBLEM_KIND[p], message: `${b.id} של ${t.id} מפר מגבלה (${p})`, taskId: t.id, blockIds: [b.id] });
        }
      }
    }
  }
  for (const t of tasks) {
    const mine = byTask.get(t.id);
    if (!mine || mine.length === 0) continue;
    const start = Math.min(...mine.map((b) => abs.get(b.id)!.start));
    for (const dep of t.dependsOn) {
      const depBlocks = byTask.get(dep);
      if (!depBlocks || depBlocks.length === 0) {
        if (unplacedIds.has(dep)) out.push({ kind: 'dependency_unplaced', message: `${t.id} משובצת אך ${dep} שהיא תלויה בה לא`, taskId: t.id });
        continue;
      }
      if (Math.max(...depBlocks.map((b) => abs.get(b.id)!.end)) > start) {
        out.push({ kind: 'dependency_order', message: `${t.id} מתחילה לפני ש-${dep} הסתיימה`, taskId: t.id });
      }
    }
  }

  // שינה: לכל לילה פעיל, בלוק אחד במינימום או דיווח
  const reported = new Set(exceptions.sleepShortfalls.map((s) => s.date));
  const sleeps = blocks.filter((b) => b.kind === 'sleep');
  for (const date of week.activeDates) {
    const win = nightWindow(grid, date);
    const inNight = sleeps.filter((b) => {
      const s = abs.get(b.id)!.start;
      return s >= win.startAbs && s < win.endAbs;
    });
    if (inNight.length > 1) {
      out.push({ kind: 'sleep_multiple', message: `יותר מבלוק שינה אחד בלילה ${date}`, date, blockIds: inNight.map((b) => b.id) });
    }
    const longest = Math.max(0, ...inNight.map((b) => abs.get(b.id)!.end - abs.get(b.id)!.start));
    if (longest < input.settings.minSleepMin && !reported.has(date)) {
      out.push({ kind: 'sleep_missing', message: `אין שינה רציפה מספקת בלילה ${date} ואין דיווח`, date });
    }
  }
  return out;
}
