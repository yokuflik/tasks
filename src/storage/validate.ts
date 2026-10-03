import type { Category, Settings, Task, Week } from '../contracts/index';
import { MAX_CATEGORIES } from '../contracts/index';

export interface StoredData {
  settings: Settings;
  categories: Category[];
  tasks: Task[];
  weeks: Week[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isMin = (v: unknown): v is number => isInt(v) && (v as number) >= 0 && (v as number) <= 2880;

export function isIsoDate(v: unknown): v is string {
  if (!isStr(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const oneOf = (v: unknown, list: readonly string[]): boolean => isStr(v) && list.includes(v);

/** אוסף שגיאות בלי לזרוק. */
class Problems {
  readonly list: string[] = [];
  add(where: string, msg: string): void {
    this.list.push(`${where}: ${msg}`);
  }
  check(cond: boolean, where: string, msg: string): boolean {
    if (!cond) this.add(where, msg);
    return cond;
  }
}

function optional(o: Obj, key: string, test: (v: unknown) => boolean): boolean {
  return !(key in o) || o[key] === undefined || test(o[key]);
}

function isWindow(v: unknown): boolean {
  return isObj(v) && isMin(v['startMin']) && isMin(v['endMin']) && (v['endMin'] as number) > (v['startMin'] as number);
}

function isRange(v: unknown): boolean {
  return isObj(v) && isIsoDate(v['date']) && isWindow(v);
}

function checkSettings(s: unknown, p: Problems): void {
  if (!p.check(isObj(s), 'settings', 'חייב להיות אובייקט') || !isObj(s)) return;
  p.check(isStr(s['timeZone']) && s['timeZone'] !== '', 'settings.timeZone', 'לא תקין');
  for (const k of ['minSleepMin', 'targetSleepMin', 'minBreakMin']) {
    p.check(isInt(s[k]) && (s[k] as number) >= 0, `settings.${k}`, 'לא תקין');
  }
  p.check(
    !isInt(s['minSleepMin']) || !isInt(s['targetSleepMin']) || (s['targetSleepMin'] as number) >= (s['minSleepMin'] as number),
    'settings', 'יעד השינה קטן מהמינימום',
  );
  p.check(optional(s, 'maxConsecutiveMin', isInt), 'settings.maxConsecutiveMin', 'לא תקין');
  p.check(isBool(s['warnOnSpecialDays']), 'settings.warnOnSpecialDays', 'לא תקין');
  p.check(optional(s, 'lastBackupAt', (v) => isStr(v) && !Number.isNaN(Date.parse(v))), 'settings.lastBackupAt', 'לא תקין');
  p.check(isInt(s['schemaVersion']), 'settings.schemaVersion', 'לא תקין');
  p.check(!('sleepStart' in s) && !('sleepEnd' in s), 'settings', 'אסור שיהיו שעות שינה ברירת מחדל');
}

function checkCategory(c: unknown, i: number, p: Problems): void {
  const w = `categories[${i}]`;
  if (!p.check(isObj(c), w, 'חייב להיות אובייקט') || !isObj(c)) return;
  p.check(isStr(c['id']) && c['id'] !== '', `${w}.id`, 'לא תקין');
  for (const k of ['name', 'color', 'icon']) p.check(isStr(c[k]), `${w}.${k}`, 'לא תקין');
  p.check(isBool(c['fixed']) && isBool(c['canCombine']), w, 'fixed/canCombine לא תקינים');
  p.check(optional(c, 'preferredWindow', isWindow), `${w}.preferredWindow`, 'לא תקין');
  p.check(optional(c, 'dailyCapMin', isInt), `${w}.dailyCapMin`, 'לא תקין');
}

function checkTask(t: unknown, i: number, p: Problems): void {
  const w = `tasks[${i}]`;
  if (!p.check(isObj(t), w, 'חייב להיות אובייקט') || !isObj(t)) return;
  p.check(isStr(t['id']) && t['id'] !== '', `${w}.id`, 'לא תקין');
  p.check(isStr(t['title']), `${w}.title`, 'לא תקין');
  p.check(optional(t, 'notes', isStr), `${w}.notes`, 'לא תקין');
  p.check(isStr(t['categoryId']), `${w}.categoryId`, 'לא תקין');
  p.check(isInt(t['durationMin']) && (t['durationMin'] as number) > 0, `${w}.durationMin`, 'לא תקין');
  p.check(optional(t, 'travelMin', isInt), `${w}.travelMin`, 'לא תקין');
  p.check(oneOf(t['priority'], ['low', 'medium', 'high']), `${w}.priority`, 'לא תקין');
  p.check(optional(t, 'dueDate', isIsoDate), `${w}.dueDate`, 'לא תקין');
  p.check(optional(t, 'weekId', isStr), `${w}.weekId`, 'לא תקין');
  p.check(oneOf(t['flexibility'], ['fixed', 'semi', 'flexible']), `${w}.flexibility`, 'לא תקין');
  p.check(oneOf(t['effort'], ['heavy', 'medium', 'light']), `${w}.effort`, 'לא תקין');
  p.check(oneOf(t['status'], ['pending', 'scheduled', 'done', 'postponed']), `${w}.status`, 'לא תקין');
  p.check(isInt(t['timesPerWeek']) && (t['timesPerWeek'] as number) >= 1, `${w}.timesPerWeek`, 'לא תקין');
  p.check(Array.isArray(t['dependsOn']) && (t['dependsOn'] as unknown[]).every(isStr), `${w}.dependsOn`, 'לא תקין');
  const sp = t['split'];
  p.check(isObj(sp) && isBool(sp['splittable']) && optional(sp, 'minSegmentMin', isInt), `${w}.split`, 'לא תקין');
  const c = t['constraints'];
  if (p.check(isObj(c), `${w}.constraints`, 'חייב להיות אובייקט') && isObj(c)) {
    p.check(optional(c, 'fixedDate', isIsoDate), `${w}.constraints.fixedDate`, 'לא תקין');
    p.check(optional(c, 'fixedStartMin', isMin), `${w}.constraints.fixedStartMin`, 'לא תקין');
    p.check(optional(c, 'allowedWindow', isWindow), `${w}.constraints.allowedWindow`, 'לא תקין');
    p.check(
      optional(c, 'forbiddenWeekdays', (v) => Array.isArray(v) && v.every((d) => isInt(d) && d >= 0 && d <= 6)),
      `${w}.constraints.forbiddenWeekdays`, 'לא תקין',
    );
    p.check(
      optional(c, 'forbiddenWindows', (v) => Array.isArray(v) && v.every(isWindow)),
      `${w}.constraints.forbiddenWindows`, 'לא תקין',
    );
  }
}

const REASONS = [
  'not_enough_time', 'deadline_conflict', 'larger_than_any_window', 'forbidden_time',
  'fixed_conflict', 'circular_dependency', 'dependency_unplaced', 'would_break_sleep',
];

function checkSchedule(s: unknown, w: string, p: Problems): void {
  if (!p.check(isObj(s), w, 'חייב להיות אובייקט') || !isObj(s)) return;
  p.check(isStr(s['id']) && s['id'] !== '', `${w}.id`, 'לא תקין');
  p.check(oneOf(s['personality'], ['balanced', 'early', 'themed']), `${w}.personality`, 'לא תקין');
  p.check(isNum(s['seed']), `${w}.seed`, 'לא תקין');
  const sc = s['score'];
  p.check(isObj(sc) && isNum(sc['total']) && isObj(sc['penalties']), `${w}.score`, 'לא תקין');
  if (p.check(Array.isArray(s['blocks']), `${w}.blocks`, 'חייב להיות מערך')) {
    (s['blocks'] as unknown[]).forEach((b, j) => {
      const bw = `${w}.blocks[${j}]`;
      if (!p.check(isObj(b), bw, 'חייב להיות אובייקט') || !isObj(b)) return;
      p.check(isStr(b['id']), `${bw}.id`, 'לא תקין');
      p.check(oneOf(b['kind'], ['task', 'sleep']), `${bw}.kind`, 'לא תקין');
      p.check(b['kind'] !== 'task' || isStr(b['taskId']), `${bw}.taskId`, 'חובה בבלוק משימה');
      p.check(optional(b, 'segment', isInt), `${bw}.segment`, 'לא תקין');
      p.check(isRange(b['range']), `${bw}.range`, 'טווח לא תקין');
      p.check(isBool(b['locked']), `${bw}.locked`, 'לא תקין');
    });
  }
  const ex = s['exceptions'];
  if (p.check(isObj(ex) && Array.isArray(ex['unplaced']) && Array.isArray(ex['sleepShortfalls']), `${w}.exceptions`, 'לא תקין') && isObj(ex)) {
    (ex['unplaced'] as unknown[]).forEach((u, j) =>
      p.check(isObj(u) && isStr(u['taskId']) && oneOf(u['reason'], REASONS), `${w}.exceptions.unplaced[${j}]`, 'לא תקין'));
    (ex['sleepShortfalls'] as unknown[]).forEach((u, j) =>
      p.check(isObj(u) && isIsoDate(u['date']) && isNum(u['availableMin']) && isNum(u['requiredMin']), `${w}.exceptions.sleepShortfalls[${j}]`, 'לא תקין'));
  }
}

function checkWeek(wk: unknown, i: number, p: Problems): void {
  const w = `weeks[${i}]`;
  if (!p.check(isObj(wk), w, 'חייב להיות אובייקט') || !isObj(wk)) return;
  p.check(isStr(wk['id']) && wk['id'] !== '', `${w}.id`, 'לא תקין');
  if (p.check(isIsoDate(wk['startDate']), `${w}.startDate`, 'לא תקין')) {
    const day = new Date((wk['startDate'] as string) + 'T12:00:00Z').getUTCDay();
    p.check(day === 0, `${w}.startDate`, 'השבוע חייב להתחיל ביום ראשון');
  }
  p.check(Array.isArray(wk['activeDates']) && (wk['activeDates'] as unknown[]).every(isIsoDate), `${w}.activeDates`, 'לא תקין');
  p.check(
    optional(wk, 'dayWindows', (v) => isObj(v) && Object.entries(v).every(([d, win]) => isIsoDate(d) && isWindow(win))),
    `${w}.dayWindows`, 'לא תקין',
  );
  if (p.check(Array.isArray(wk['blockedTimes']), `${w}.blockedTimes`, 'חייב להיות מערך')) {
    (wk['blockedTimes'] as unknown[]).forEach((b, j) =>
      p.check(isObj(b) && isStr(b['id']) && isStr(b['title']) && isRange(b['range']) && oneOf(b['source'], ['manual', 'ics']),
        `${w}.blockedTimes[${j}]`, 'לא תקין'));
  }
  p.check(Array.isArray(wk['taskIds']) && (wk['taskIds'] as unknown[]).every(isStr), `${w}.taskIds`, 'לא תקין');
  if (p.check(Array.isArray(wk['schedules']), `${w}.schedules`, 'חייב להיות מערך')) {
    (wk['schedules'] as unknown[]).forEach((s, j) => checkSchedule(s, `${w}.schedules[${j}]`, p));
  }
  p.check(optional(wk, 'selectedScheduleId', isStr), `${w}.selectedScheduleId`, 'לא תקין');
}

function duplicates(ids: unknown[]): string[] {
  const seen = new Set<unknown>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(String(id));
    seen.add(id);
  }
  return [...dup];
}

/** בדיקת מבנה ושלמות הפניות. מחזיר רשימת בעיות, ריקה אם תקין. */
export function validateData(data: unknown): string[] {
  const p = new Problems();
  if (!isObj(data)) return ['הנתונים אינם אובייקט'];
  checkSettings(data['settings'], p);
  const lists = (['categories', 'tasks', 'weeks'] as const).filter((k) => p.check(Array.isArray(data[k]), k, 'חייב להיות מערך'));
  if (lists.length < 3) return p.list;

  const categories = data['categories'] as unknown[];
  const tasks = data['tasks'] as unknown[];
  const weeks = data['weeks'] as unknown[];
  p.check(categories.length >= 1 && categories.length <= MAX_CATEGORIES, 'categories', `מספר קטגוריות מחוץ ל-1..${MAX_CATEGORIES}`);
  categories.forEach((c, i) => checkCategory(c, i, p));
  tasks.forEach((t, i) => checkTask(t, i, p));
  weeks.forEach((w, i) => checkWeek(w, i, p));
  if (p.list.length > 0) return p.list;

  const cats = categories as Category[];
  const ts = tasks as Task[];
  const ws = weeks as Week[];
  for (const [name, ids] of [['categories', cats.map((c) => c.id)], ['tasks', ts.map((t) => t.id)], ['weeks', ws.map((w) => w.id)]] as const) {
    duplicates([...ids]).forEach((d) => p.add(name, `מזהה כפול ${d}`));
  }
  const catIds = new Set(cats.map((c) => c.id));
  const taskIds = new Set(ts.map((t) => t.id));
  const weekIds = new Set(ws.map((w) => w.id));
  for (const t of ts) {
    p.check(catIds.has(t.categoryId), `task ${t.id}`, `קטגוריה לא קיימת ${t.categoryId}`);
    if (t.weekId !== undefined) p.check(weekIds.has(t.weekId), `task ${t.id}`, `שבוע לא קיים ${t.weekId}`);
    t.dependsOn.forEach((d) => p.check(taskIds.has(d), `task ${t.id}`, `תלות במשימה לא קיימת ${d}`));
  }
  for (const w of ws) {
    w.taskIds.forEach((id) => p.check(taskIds.has(id), `week ${w.id}`, `משימה לא קיימת ${id}`));
    p.check(
      w.selectedScheduleId === undefined || w.schedules.some((s) => s.id === w.selectedScheduleId),
      `week ${w.id}`, 'הסידור הנבחר לא קיים',
    );
    duplicates(w.schedules.map((s) => s.id)).forEach((d) => p.add(`week ${w.id}`, `מזהה סידור כפול ${d}`));
  }
  return p.list;
}
