/**
 * חישובי תאריך ושבוע (P2). IsoDate הוא "YYYY-MM-DD" בשעון מקומי, והחישובים כאן
 * אינם תלויים באזור זמן: הם פועלים על לוח גרגוריאני טהור (UTC פנימי בלבד).
 */
import { WEEK_START, type IsoDate, type Weekday } from '../contracts';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DAY = 86_400_000;

/** מפרק ומאמת IsoDate. זורק על פורמט שגוי או תאריך שאינו קיים (למשל 2026-02-30). */
function parse(date: IsoDate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new RangeError(`IsoDate לא תקין: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new RangeError(`IsoDate לא קיים: ${date}`);
  }
  return ms;
}

function format(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidIsoDate(date: string): boolean {
  try {
    parse(date);
    return true;
  } catch {
    return false;
  }
}

/** מספר היום בשבוע: 0 = ראשון ... 6 = שבת. */
export function weekdayOf(date: IsoDate): Weekday {
  return new Date(parse(date)).getUTCDay() as Weekday;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return format(parse(date) + days * MS_DAY);
}

/** הפרש בימים (b פחות a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parse(b) - parse(a)) / MS_DAY);
}

/** תאריך תחילת השבוע (יום ראשון) שמכיל את התאריך. */
export function weekStartOf(date: IsoDate): IsoDate {
  const offset = (weekdayOf(date) - WEEK_START + 7) % 7;
  return addDays(date, -offset);
}

export function isWeekStart(date: IsoDate): boolean {
  return weekdayOf(date) === WEEK_START;
}

/** שבעת ימי השבוע, מיום ראשון עד שבת. מקבל כל תאריך בשבוע. */
export function weekDates(date: IsoDate): IsoDate[] {
  const start = weekStartOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** מעבר שבועות: offset חיובי קדימה, שלילי אחורה. מחזיר תאריך ראשון. */
export function shiftWeek(date: IsoDate, offset: number): IsoDate {
  return addDays(weekStartOf(date), offset * 7);
}

export const nextWeekStart = (date: IsoDate): IsoDate => shiftWeek(date, 1);
export const prevWeekStart = (date: IsoDate): IsoDate => shiftWeek(date, -1);

/** תאריכים מ-from עד to כולל. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const n = diffDays(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}
