/** לוגיקה טהורה של המסכים (P7): בלי DOM ובלי אחסון, כדי לבדוק אותה לבד. */
import type {
  Category,
  Effort,
  Flexibility,
  Id,
  IsoDate,
  Minutes,
  Personality,
  Priority,
  Schedule,
  ScheduleBlock,
  Settings,
  Task,
  UnplacedReason,
  Week,
} from '../contracts';
import { GRID_MINUTES } from '../contracts';
import { validateHardRules } from '../engine/base';
import { addDays, weekDates } from '../time';

export const DAY_MIN = 1440;

// ---------- זמן ----------

/** "HH:MM" לדקות. מחזיר undefined לקלט לא תקין. */
export function parseTimeInput(value: string): Minutes | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return undefined;
  return h * 60 + mi;
}

export function timeInputValue(min: Minutes): string {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** שעת סיום שקטנה או שווה להתחלה פירושה שהטווח חוצה חצות. */
export function endAfter(startMin: Minutes, endMin: Minutes): Minutes {
  return endMin > startMin ? endMin : endMin + DAY_MIN;
}

export function snap(min: number, step: number = GRID_MINUTES): number {
  return Math.round(min / step) * step;
}

export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;

/** "11/10" מתאריך ISO. */
export function shortDate(date: IsoDate): string {
  return `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
}

// ---------- מזהים ----------

let counter = 0;
export function newId(prefix: string): Id {
  counter += 1;
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${rand}`;
}

// ---------- בניית ישויות ----------

export function createWeek(startDate: IsoDate): Week {
  return {
    id: `week-${startDate}`,
    startDate,
    activeDates: weekDates(startDate),
    blockedTimes: [],
    taskIds: [],
    schedules: [],
  };
}

export interface ShiftInput {
  date: IsoDate;
  startMin: Minutes;
  endMin: Minutes;
  title?: string;
}

/** משמרת עבודה = משימה קבועה בקטגוריה work (לפי החוזה). */
export function createShift(weekId: Id, input: ShiftInput, id: Id = newId('shift')): Task {
  const end = endAfter(input.startMin, input.endMin);
  return {
    id,
    title: input.title?.trim() || 'משמרת',
    categoryId: 'work',
    durationMin: end - input.startMin,
    priority: 'high',
    weekId,
    constraints: { fixedDate: input.date, fixedStartMin: input.startMin },
    flexibility: 'fixed',
    split: { splittable: false },
    dependsOn: [],
    effort: 'medium',
    timesPerWeek: 1,
    status: 'pending',
  };
}

export interface TaskForm {
  title: string;
  notes?: string;
  categoryId: Id;
  durationMin: Minutes;
  priority: Priority;
  effort: Effort;
  flexibility: Flexibility;
  timesPerWeek: number;
  dueDate?: IsoDate;
  fixedDate?: IsoDate;
  fixedStartMin?: Minutes;
  splittable: boolean;
  minSegmentMin?: Minutes;
  dependsOn: Id[];
}

export function createTask(weekId: Id, form: TaskForm, id: Id = newId('task')): Task {
  const constraints: Task['constraints'] = {};
  if (form.fixedDate) constraints.fixedDate = form.fixedDate;
  if (form.fixedStartMin !== undefined) constraints.fixedStartMin = form.fixedStartMin;
  const task: Task = {
    id,
    title: form.title.trim(),
    categoryId: form.categoryId,
    durationMin: form.durationMin,
    priority: form.priority,
    weekId,
    constraints,
    flexibility: form.flexibility,
    split: form.splittable
      ? { splittable: true, ...(form.minSegmentMin !== undefined ? { minSegmentMin: form.minSegmentMin } : {}) }
      : { splittable: false },
    dependsOn: form.dependsOn,
    effort: form.effort,
    timesPerWeek: Math.max(1, Math.floor(form.timesPerWeek)),
    status: 'pending',
  };
  if (form.notes?.trim()) task.notes = form.notes.trim();
  if (form.dueDate) task.dueDate = form.dueDate;
  return task;
}

export interface TaskFormErrors {
  title?: string;
  duration?: string;
  fixed?: string;
}

export function validateTaskForm(form: TaskForm): TaskFormErrors {
  const errors: TaskFormErrors = {};
  if (!form.title.trim()) errors.title = 'חסרה כותרת';
  if (!Number.isFinite(form.durationMin) || form.durationMin < GRID_MINUTES) errors.duration = `משך מינימלי ${GRID_MINUTES} דקות`;
  else if (form.durationMin % GRID_MINUTES !== 0) errors.duration = `המשך בכפולות של ${GRID_MINUTES} דקות`;
  if (form.fixedStartMin !== undefined && !form.fixedDate) errors.fixed = 'שעה קבועה דורשת יום קבוע';
  return errors;
}

/** משמרות של השבוע (משימות עבודה קבועות). */
export function isShift(task: Task): boolean {
  return task.categoryId === 'work' && task.flexibility === 'fixed';
}

/** העתקת משימות לא-קבועות משבוע קודם: מזהים חדשים, סטטוס ממתינה, תאריכים מוזזים בשבוע. */
export function copyTasksToNextWeek(source: readonly Task[], targetWeekId: Id, dayOffset: number): Task[] {
  const idMap = new Map<Id, Id>();
  const picked = source.filter((t) => !isShift(t));
  for (const t of picked) idMap.set(t.id, newId('task'));
  return picked.map((t) => {
    const constraints: Task['constraints'] = { ...t.constraints };
    if (constraints.fixedDate) constraints.fixedDate = addDays(constraints.fixedDate, dayOffset);
    const copy: Task = {
      ...t,
      id: idMap.get(t.id)!,
      weekId: targetWeekId,
      constraints,
      dependsOn: t.dependsOn.flatMap((d) => (idMap.has(d) ? [idMap.get(d)!] : [])),
      status: 'pending',
    };
    if (t.dueDate) copy.dueDate = addDays(t.dueDate, dayOffset);
    return copy;
  });
}

// ---------- בלוקים לפי יום ----------

export interface DaySegment {
  block: ScheduleBlock;
  /** דקות בתוך היום המוצג (0..1440). */
  startMin: Minutes;
  endMin: Minutes;
  /** המשך של בלוק שהתחיל ביום הקודם (חוצה חצות). */
  continuation: boolean;
}

/** כל מה שנוגע ביום: בלוקים שהתחילו בו, והמשך של בלוקים שחצו חצות מאתמול. */
export function segmentsForDate(blocks: readonly ScheduleBlock[], date: IsoDate): DaySegment[] {
  const out: DaySegment[] = [];
  const prev = addDays(date, -1);
  for (const b of blocks) {
    if (b.range.date === date) {
      out.push({ block: b, startMin: b.range.startMin, endMin: Math.min(b.range.endMin, DAY_MIN), continuation: false });
    } else if (b.range.date === prev && b.range.endMin > DAY_MIN) {
      out.push({ block: b, startMin: 0, endMin: b.range.endMin - DAY_MIN, continuation: true });
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

export function blockMinutes(b: ScheduleBlock): Minutes {
  return b.range.endMin - b.range.startMin;
}

/** דקות עבודה ומשימות (בלי שינה) שמתחילות ביום. */
export function dayLoadMin(blocks: readonly ScheduleBlock[], date: IsoDate): Minutes {
  return blocks.filter((b) => b.kind === 'task' && b.range.date === date).reduce((s, b) => s + blockMinutes(b), 0);
}

/** זמן פנוי ליום להצגת היחס: חלון היום אם הוגדר, אחרת היום פחות השינה שנוגעת בו. */
export function dayAvailableMin(week: Pick<Week, 'dayWindows'>, blocks: readonly ScheduleBlock[], date: IsoDate): Minutes {
  const w = week.dayWindows?.[date];
  if (w) return Math.max(0, w.endMin - w.startMin);
  const sleep = segmentsForDate(blocks, date)
    .filter((s) => s.block.kind === 'sleep')
    .reduce((n, s) => n + (s.endMin - s.startMin), 0);
  return Math.max(0, DAY_MIN - sleep);
}

/** שינה בלילה שמתחיל בתאריך. */
export function sleepMinForNight(blocks: readonly ScheduleBlock[], date: IsoDate): Minutes {
  return blocks.filter((b) => b.kind === 'sleep' && b.range.date === date).reduce((s, b) => s + blockMinutes(b), 0);
}

export function categoryTotals(
  blocks: readonly ScheduleBlock[],
  tasks: readonly Task[],
  categories: readonly Category[],
): { category: Category; minutes: Minutes }[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const sums = new Map<Id, Minutes>();
  for (const b of blocks) {
    if (b.kind !== 'task' || !b.taskId) continue;
    const t = taskById.get(b.taskId);
    if (t) sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + blockMinutes(b));
  }
  return categories.filter((c) => sums.has(c.id)).map((c) => ({ category: c, minutes: sums.get(c.id)! }));
}

// ---------- השוואה ----------

export const PERSONALITY_LABEL: Record<Personality, string> = {
  balanced: 'מאוזן',
  early: 'מוקדם ודחוף',
  themed: 'נושאי יום',
};

/** סיכום קצר שמתאר את הסידור, לפי האישיות והנתונים. */
export function scheduleSummary(schedule: Schedule): string {
  const unplaced = schedule.exceptions.unplaced.length;
  const base: Record<Personality, string> = {
    balanced: 'עומס מאוזן',
    early: 'הכול מוקדם',
    themed: 'ימים לפי נושא',
  };
  return unplaced > 0 ? `${base[schedule.personality]} · ${unplaced} לא נכנסו` : base[schedule.personality];
}

const blockKey = (b: ScheduleBlock): string => (b.kind === 'sleep' ? `sleep:${b.range.date}` : `${b.taskId}#${b.segment ?? 0}`);
const placeKey = (b: ScheduleBlock): string => `${b.range.date}@${b.range.startMin}`;

/** מזהי בלוקים שממוקמים אחרת לפחות באחד מהסידורים האחרים (להדגשת הבדלים). */
export function differingBlockIds(schedules: readonly Schedule[], index: number): Set<Id> {
  const me = schedules[index];
  const out = new Set<Id>();
  if (!me) return out;
  const others = schedules.filter((_, i) => i !== index);
  for (const b of me.blocks) {
    if (b.kind !== 'task') continue;
    const key = blockKey(b);
    const differs = others.some((o) => {
      const match = o.blocks.find((x) => blockKey(x) === key);
      return !match || placeKey(match) !== placeKey(b);
    });
    if (differs) out.add(b.id);
  }
  return out;
}

export const REASON_LABEL: Record<UnplacedReason, string> = {
  not_enough_time: 'אין מספיק זמן',
  deadline_conflict: 'התנגשות עם תאריך יעד',
  larger_than_any_window: 'גדולה מכל חלון פנוי',
  forbidden_time: 'כל הזמנים אסורים',
  fixed_conflict: 'התנגשות עם משימה קבועה',
  circular_dependency: 'תלות מעגלית',
  dependency_unplaced: 'תלויה במשימה שלא נכנסה',
  would_break_sleep: 'הייתה פוגעת בשינה',
};

// ---------- עריכה ידנית ----------

export type MoveResult =
  | { ok: true; schedule: Schedule }
  | { ok: false; reason: string };

export interface EditContext {
  week: Pick<Week, 'startDate' | 'activeDates' | 'dayWindows' | 'blockedTimes'>;
  tasks: readonly Task[];
  categories: readonly Category[];
  settings: Pick<Settings, 'minSleepMin'>;
}

export function isBlockMovable(block: ScheduleBlock, ctx: Pick<EditContext, 'tasks' | 'categories'>): boolean {
  if (block.kind !== 'task' || block.locked) return false;
  const task = ctx.tasks.find((t) => t.id === block.taskId);
  if (!task) return false;
  const cat = ctx.categories.find((c) => c.id === task.categoryId);
  return task.flexibility !== 'fixed' && !cat?.fixed;
}

function violationKeys(schedule: Schedule, ctx: EditContext, blocks: readonly ScheduleBlock[]): Map<string, string> {
  const list = validateHardRules({
    week: ctx.week,
    tasks: ctx.tasks,
    categories: ctx.categories,
    settings: ctx.settings,
    blocks,
    exceptions: schedule.exceptions,
  });
  return new Map(list.map((v) => [`${v.kind}:${v.taskId ?? ''}:${[...(v.blockIds ?? [])].sort().join(',')}:${v.date ?? ''}`, v.message]));
}

/**
 * הזזת בלוק לתאריך ושעה. נדחית אם הבלוק קבוע או נעול, או אם ההזזה יוצרת הפרה חדשה
 * של חוק קשיח (חפיפה, שינה, תלות, יום או שעה אסורים וכד'). הפרות שכבר היו קיימות לא חוסמות.
 */
export function moveBlock(schedule: Schedule, blockId: Id, date: IsoDate, startMin: Minutes, ctx: EditContext): MoveResult {
  const block = schedule.blocks.find((b) => b.id === blockId);
  if (!block) return { ok: false, reason: 'הבלוק לא נמצא' };
  if (block.kind === 'sleep') return { ok: false, reason: 'אי אפשר להזיז שינה' };
  if (block.locked) return { ok: false, reason: 'הבלוק נעול. שחרר אותו כדי להזיז' };
  if (!isBlockMovable(block, ctx)) return { ok: false, reason: 'משימה קבועה אינה ניתנת להזזה' };
  if (!ctx.week.activeDates.includes(date)) return { ok: false, reason: 'היום אינו פעיל בשבוע' };
  const start = snap(startMin);
  if (start < 0 || start >= DAY_MIN) return { ok: false, reason: 'שעה מחוץ ליום' };
  const len = blockMinutes(block);
  const moved: ScheduleBlock = { ...block, range: { date, startMin: start, endMin: start + len } };
  const blocks = schedule.blocks.map((b) => (b.id === blockId ? moved : b));
  const before = violationKeys(schedule, ctx, schedule.blocks);
  const after = violationKeys(schedule, ctx, blocks);
  for (const [key, message] of after) if (!before.has(key)) return { ok: false, reason: message };
  return { ok: true, schedule: { ...schedule, blocks } };
}

export function setBlockLocked(schedule: Schedule, blockId: Id, locked: boolean): Schedule {
  return { ...schedule, blocks: schedule.blocks.map((b) => (b.id === blockId ? { ...b, locked } : b)) };
}

/** בלוקים שהשיבוץ מחדש חייב לשמר: נעולים ידנית, כולל שינה שננעלה בלילה מסוים. */
export function lockedBlocksOf(schedule: Schedule | undefined): ScheduleBlock[] {
  return schedule ? schedule.blocks.filter((b) => b.locked) : [];
}

// ---------- גרירה ----------

export interface ColumnRect {
  date: IsoDate;
  left: number;
  right: number;
}

export interface DropTarget {
  date: IsoDate;
  startMin: Minutes;
}

/** מתרגם נקודת מגע למקום בגריד: עמודה לפי x ושעה לפי y, צמוד למשבצת של 15 דקות. */
export function dropTarget(
  x: number,
  y: number,
  columns: readonly ColumnRect[],
  gridTop: number,
  pxPerMin: number,
  grabOffsetMin: Minutes,
): DropTarget | undefined {
  const col = columns.find((c) => x >= c.left && x < c.right);
  if (!col) return undefined;
  const raw = (y - gridTop) / pxPerMin - grabOffsetMin;
  return { date: col.date, startMin: Math.min(DAY_MIN - GRID_MINUTES, Math.max(0, snap(raw))) };
}

export type PressOutcome = 'tap' | 'long-press' | 'drag';

/** מבדיל בין נגיעה, לחיצה ארוכה (נעילה) וגרירה. */
export function classifyPress(movedPx: number, heldMs: number, opts: { slopPx?: number; longMs?: number } = {}): PressOutcome {
  const slop = opts.slopPx ?? 8;
  const long = opts.longMs ?? 450;
  if (movedPx > slop) return 'drag';
  return heldMs >= long ? 'long-press' : 'tap';
}

/** החלקה אופקית מספיק גדולה וברורה מסמנת "בוצע". */
export function isDoneSwipe(dx: number, dy: number, thresholdPx = 80): boolean {
  return Math.abs(dx) >= thresholdPx && Math.abs(dx) > Math.abs(dy) * 1.5;
}

// ---------- בחירה ועדכון ----------

export function selectedSchedule(week: Week | undefined): Schedule | undefined {
  return week?.schedules.find((s) => s.id === week.selectedScheduleId);
}

export function replaceSchedule(week: Week, schedule: Schedule): Week {
  return { ...week, schedules: week.schedules.map((s) => (s.id === schedule.id ? schedule : s)) };
}
