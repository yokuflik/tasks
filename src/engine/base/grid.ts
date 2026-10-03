import { GRID_MINUTES } from '../../contracts';
import type { IsoDate, TimeRange, Week } from '../../contracts';
import { addDays, dayDiff } from './dates';

/** משבצות ביום. */
export const SLOTS_PER_DAY = 1440 / GRID_MINUTES;
/** ימי גלישה אחרי היום האחרון, כדי שמשמרת או שינה של הלילה האחרון ייכנסו לרשת. */
export const SPILL_DAYS = 2;

export const OCCUPANT = { free: 0, fixed: 1, blocked: 2, sleep: 3, locked: 4, task: 5 } as const;
export type OccupantCode = (typeof OCCUPANT)[keyof typeof OCCUPANT];

/**
 * רשת זמן של משבצות 15 דקות. זמן מוחלט = דקות מחצות של originDate, בשעון קיר.
 * open: המשבצת בתוך חלון פעיל של יום פעיל (משימות רגילות בלבד; שינה אינה כפופה לחלון).
 * busy: מי תופס את המשבצת (OCCUPANT).
 */
export interface Grid {
  originDate: IsoDate;
  dayCount: number;
  slotCount: number;
  dates: IsoDate[];
  activeDay: Uint8Array;
  open: Uint8Array;
  busy: Uint8Array;
}

export interface Run {
  /** דקות מוחלטות. */
  start: number;
  end: number;
}

export function buildGrid(week: Pick<Week, 'startDate' | 'activeDates' | 'dayWindows'>): Grid {
  const originDate = week.startDate;
  let maxIdx = 6;
  for (const d of week.activeDates) maxIdx = Math.max(maxIdx, dayDiff(originDate, d));
  const dayCount = maxIdx + 1 + SPILL_DAYS;
  const slotCount = dayCount * SLOTS_PER_DAY;
  const dates = Array.from({ length: dayCount }, (_, i) => addDays(originDate, i));
  const grid: Grid = {
    originDate,
    dayCount,
    slotCount,
    dates,
    activeDay: new Uint8Array(dayCount),
    open: new Uint8Array(slotCount),
    busy: new Uint8Array(slotCount),
  };
  for (const date of week.activeDates) {
    const idx = dayDiff(originDate, date);
    if (idx < 0 || idx >= dayCount) continue;
    grid.activeDay[idx] = 1;
    const w = week.dayWindows?.[date] ?? { startMin: 0, endMin: 1440 };
    const from = idx * SLOTS_PER_DAY + Math.ceil(w.startMin / GRID_MINUTES);
    const to = idx * SLOTS_PER_DAY + Math.floor(w.endMin / GRID_MINUTES);
    for (let s = Math.max(from, 0); s < Math.min(to, slotCount); s++) grid.open[s] = 1;
  }
  return grid;
}

export function dateOfDay(grid: Grid, dayIdx: number): IsoDate {
  return grid.dates[dayIdx] ?? addDays(grid.originDate, dayIdx);
}

/** תאריך ודקות (בשעון קיר) לדקות מוחלטות. */
export function toAbs(grid: Grid, date: IsoDate, min: number): number {
  return dayDiff(grid.originDate, date) * 1440 + min;
}

export function rangeToAbs(grid: Grid, r: TimeRange): Run {
  const base = dayDiff(grid.originDate, r.date) * 1440;
  return { start: base + r.startMin, end: base + r.endMin };
}

/** תאריך ההתחלה, ו-endMin מעל 1440 כשחוצה חצות. */
export function absToRange(grid: Grid, start: number, end: number): TimeRange {
  const dayIdx = Math.floor(start / 1440);
  return {
    date: dateOfDay(grid, dayIdx),
    startMin: start - dayIdx * 1440,
    endMin: end - dayIdx * 1440,
  };
}

/** תופס משבצות שנוגעות בטווח (עיגול החוצה). חלק מחוץ לרשת מתעלמים ממנו. */
export function occupy(grid: Grid, start: number, end: number, code: OccupantCode): void {
  const from = Math.max(Math.floor(start / GRID_MINUTES), 0);
  const to = Math.min(Math.ceil(end / GRID_MINUTES), grid.slotCount);
  for (let s = from; s < to; s++) grid.busy[s] = code;
}

export interface FreeOptions {
  /** מתעלם מחלון הפעילות (שינה). */
  ignoreOpen?: boolean;
  /** סוגי תפיסה שנחשבים כפנויים לצורך הבדיקה. */
  ignoreOccupants?: readonly OccupantCode[];
}

function slotFree(grid: Grid, s: number, o?: FreeOptions): boolean {
  if (s < 0 || s >= grid.slotCount) return false;
  if (!o?.ignoreOpen && !grid.open[s]) return false;
  const b = grid.busy[s] as OccupantCode;
  return b === OCCUPANT.free || (o?.ignoreOccupants?.includes(b) ?? false);
}

export function isRangeFree(grid: Grid, start: number, end: number, o?: FreeOptions): boolean {
  const from = Math.floor(start / GRID_MINUTES);
  const to = Math.ceil(end / GRID_MINUTES);
  if (to <= from) return false;
  for (let s = from; s < to; s++) if (!slotFree(grid, s, o)) return false;
  return true;
}

/** רצפי משבצות פנויות רצופים, בדקות מוחלטות. */
export function freeRuns(grid: Grid, o?: FreeOptions): Run[] {
  return runsWhere(grid, (s) => slotFree(grid, s, o));
}

export function runsWhere(grid: Grid, pred: (slot: number) => boolean): Run[] {
  const runs: Run[] = [];
  let from = -1;
  for (let s = 0; s <= grid.slotCount; s++) {
    const ok = s < grid.slotCount && pred(s);
    if (ok && from < 0) from = s;
    if (!ok && from >= 0) {
      runs.push({ start: from * GRID_MINUTES, end: s * GRID_MINUTES });
      from = -1;
    }
  }
  return runs;
}

export function cloneGrid(grid: Grid): Grid {
  return { ...grid, activeDay: grid.activeDay.slice(), open: grid.open.slice(), busy: grid.busy.slice() };
}
