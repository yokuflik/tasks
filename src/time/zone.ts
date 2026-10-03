/**
 * אזור זמן ומעבר שעון קיץ (P2). המרה בין שעון קיר (תאריך + דקות מחצות) לרגע מוחלט.
 *
 * מדיניות במעבר שעון:
 * - שעה שלא קיימת (הפער באביב, למשל 02:30 בלילה שמוקפץ מ-02:00 ל-03:00) נפתרת קדימה.
 * - שעה כפולה (הסתיו) נפתרת להופעה הראשונה.
 */
import type { IsoDate, Minutes } from '../contracts';
import { addDays, diffDays } from './date';

const MS_MIN = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface Wall {
  date: IsoDate;
  min: Minutes;
}

/** שעון הקיר של רגע מוחלט באזור הזמן. */
export function instantToWall(instant: Date, timeZone: string): Wall {
  const p: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) p[part.type] = part.value;
  return {
    date: `${p['year']}-${p['month']}-${p['day']}`,
    min: Number(p['hour']) * 60 + Number(p['minute']),
  };
}

/** היסט מ-UTC בדקות (חיובי מזרחה) ברגע נתון. */
export function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const w = instantToWall(instant, timeZone);
  const [y, mo, d] = w.date.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, mo - 1, d) + w.min * MS_MIN;
  const truncated = Math.floor(instant.getTime() / MS_MIN) * MS_MIN;
  return Math.round((wallAsUtc - truncated) / MS_MIN);
}

function wallAsUtcMs(date: IsoDate, min: Minutes): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d) + min * MS_MIN;
}

/** האם שעת הקיר קיימת (לא נופלת בפער של מעבר לשעון קיץ). min רשאי לחרוג מ-1440. */
export function isWallTimeValid(date: IsoDate, min: Minutes, timeZone: string): boolean {
  const inst = wallToInstant(date, min, timeZone);
  const back = instantToWall(inst, timeZone);
  return back.date === addDays(date, Math.floor(min / 1440)) && back.min === ((min % 1440) + 1440) % 1440;
}

/** רגע מוחלט משעון קיר. min רשאי לחרוג מ-1440 (טווח שחוצה חצות). */
export function wallToInstant(date: IsoDate, min: Minutes, timeZone: string): Date {
  const wall = wallAsUtcMs(date, min);
  // שני ניחושים לפי ההיסט לפני ואחרי: ההיסט הנכון הוא זה שמחזיר את אותה שעת קיר
  const o1 = utcOffsetMinutes(new Date(wall - 24 * 60 * MS_MIN), timeZone);
  const o2 = utcOffsetMinutes(new Date(wall + 24 * 60 * MS_MIN), timeZone);
  const candidates = [...new Set([o1, o2])].map((o) => wall - o * MS_MIN).sort((a, b) => a - b);
  for (const c of candidates) {
    const back = instantToWall(new Date(c), timeZone);
    if (wallAsUtcMs(back.date, back.min) === wall) return new Date(c);
  }
  // פער (שעה שלא קיימת): קדימה, לפי ההיסט שלפני המעבר
  return new Date(wall - o1 * MS_MIN);
}

/** אורך היום בדקות: 1440 רגיל, 1380 ביום מעבר לקיץ, 1500 ביום חזרה לחורף. */
export function minutesInDay(date: IsoDate, timeZone: string): Minutes {
  const start = wallToInstant(date, 0, timeZone).getTime();
  const end = wallToInstant(addDays(date, 1), 0, timeZone).getTime();
  return Math.round((end - start) / MS_MIN);
}

/** הפרש אמיתי (זמן שחלף) בדקות בין שתי שעות קיר באותו תאריך בסיס. */
export function elapsedMinutes(
  date: IsoDate,
  startMin: Minutes,
  endMin: Minutes,
  timeZone: string,
): Minutes {
  const a = wallToInstant(date, startMin, timeZone).getTime();
  const b = wallToInstant(date, endMin, timeZone).getTime();
  return Math.round((b - a) / MS_MIN);
}

/** התאריך המקומי של "עכשיו" באזור הזמן. */
export function todayIso(timeZone: string, now: Date = new Date()): IsoDate {
  return instantToWall(now, timeZone).date;
}

/**
 * שעת הסיום בשעון קיר של פעילות שנמשכת durationMin דקות אמיתיות מ-startMin.
 * ביום מעבר לקיץ פעילות שחוצה את הפער מסתיימת מאוחר יותר בשעון הקיר.
 * התוצאה יכולה לחרוג מ-1440 (על אותו date), כמו endMin בחוזה.
 */
export function endWallMinute(
  date: IsoDate,
  startMin: Minutes,
  durationMin: Minutes,
  timeZone: string,
): Minutes {
  const end = instantToWall(
    new Date(wallToInstant(date, startMin, timeZone).getTime() + durationMin * MS_MIN),
    timeZone,
  );
  return end.min + diffDays(date, end.date) * 1440;
}
