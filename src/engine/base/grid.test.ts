import { describe, expect, it } from 'vitest';
import { addDays, dayDiff, weekdayOf } from './dates';
import { absToRange, buildGrid, freeRuns, isRangeFree, occupy, OCCUPANT, rangeToAbs, SLOTS_PER_DAY, SPILL_DAYS } from './grid';
import { taskMask } from './constraints';
import { DAYS, START, task, week } from './testing/helpers';

describe('dates', () => {
  it('יום ראשון הוא 0 וחשבון ימים חוצה גבולות חודש ושנה', () => {
    expect(weekdayOf(START)).toBe(0);
    expect(weekdayOf('2026-06-13')).toBe(6);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(dayDiff('2026-02-27', '2026-03-02')).toBe(3);
  });
});

describe('grid', () => {
  it('7 ימים פעילים + ימי גלישה, 96 משבצות ליום, הכל פתוח ופנוי', () => {
    const g = buildGrid(week());
    expect(g.dayCount).toBe(7 + SPILL_DAYS);
    expect(g.slotCount).toBe(g.dayCount * SLOTS_PER_DAY);
    expect(g.open.slice(0, 7 * SLOTS_PER_DAY).every((x) => x === 1)).toBe(true);
    expect(g.open.slice(7 * SLOTS_PER_DAY).every((x) => x === 0)).toBe(true);
    expect(g.busy.every((x) => x === 0)).toBe(true);
  });

  it('חלון יומי מגביל את המשבצות הפתוחות, ויום לא פעיל סגור', () => {
    const d1 = DAYS[1]!;
    const g = buildGrid(week({ activeDates: [START, d1], dayWindows: { [d1]: { startMin: 540, endMin: 720 } } }));
    expect(isRangeFree(g, 0, 1440)).toBe(true);
    expect(isRangeFree(g, 1440 + 540, 1440 + 720)).toBe(true);
    expect(isRangeFree(g, 1440 + 525, 1440 + 540)).toBe(false);
    expect(isRangeFree(g, 1440 + 720, 1440 + 735)).toBe(false);
    expect(isRangeFree(g, 2 * 1440, 2 * 1440 + 60)).toBe(false);
  });

  it('המרת טווח לדקות מוחלטות ובחזרה, כולל טווח שחוצה חצות', () => {
    const g = buildGrid(week());
    const r = { date: DAYS[2]!, startMin: 1320, endMin: 1800 };
    const a = rangeToAbs(g, r);
    expect(a).toEqual({ start: 2 * 1440 + 1320, end: 2 * 1440 + 1800 });
    expect(absToRange(g, a.start, a.end)).toEqual(r);
    // התחלה אחרי חצות מקבלת את תאריך ההתחלה
    expect(absToRange(g, 3 * 1440 + 60, 3 * 1440 + 120)).toEqual({ date: DAYS[3], startMin: 60, endMin: 120 });
  });

  it('תפיסה מורידה זמן פנוי ומפצלת רצפים; עיגול החוצה למשבצת שלמה', () => {
    const g = buildGrid(week({ activeDates: [START] }));
    occupy(g, 600, 650, OCCUPANT.blocked); // 10:00-10:50 -> עד 11:00
    expect(isRangeFree(g, 600, 660)).toBe(false);
    expect(isRangeFree(g, 660, 720)).toBe(true);
    const runs = freeRuns(g);
    expect(runs).toEqual([
      { start: 0, end: 600 },
      { start: 660, end: 1440 },
    ]);
    expect(freeRuns(g, { ignoreOccupants: [OCCUPANT.blocked] })).toEqual([{ start: 0, end: 1440 }]);
  });

  it('שעון קיר: יום מעבר שעון הוא עדיין 96 משבצות (התאמה היא באחריות P2)', () => {
    const g = buildGrid(week({ startDate: '2026-03-22', activeDates: ['2026-03-27'] }));
    expect(rangeToAbs(g, { date: '2026-03-27', startMin: 30, endMin: 150 })).toEqual({ start: 5 * 1440 + 30, end: 5 * 1440 + 150 });
  });
});

describe('constraints', () => {
  it('מסכה מכבדת ימים אסורים, חלונות אסורים ותאריך יעד', () => {
    const g = buildGrid(week());
    const t = task('t', {
      constraints: { forbiddenWeekdays: [5, 6], forbiddenWindows: [{ startMin: 0, endMin: 720 }] },
      dueDate: DAYS[2]!,
    });
    const m = taskMask(g, t);
    const at = (day: number, min: number) => m[day * SLOTS_PER_DAY + min / 15];
    expect(at(0, 11 * 60 + 45)).toBe(0);
    expect(at(0, 12 * 60)).toBe(1);
    expect(at(2, 23 * 60 + 45)).toBe(1);
    expect(at(3, 13 * 60)).toBe(0); // אחרי היעד
  });

  it('שעה קבועה מפורשת פותחת רק את הטווח המדויק, גם מחוץ לחלון הפעילות', () => {
    const d = DAYS[1]!;
    const g = buildGrid(week({ dayWindows: { [d]: { startMin: 540, endMin: 600 } } }));
    const t = task('t', { durationMin: 60, constraints: { fixedDate: d, fixedStartMin: 1200 } });
    const m = taskMask(g, t);
    const on = Array.from(m.keys()).filter((i) => m[i] === 1);
    expect(on).toEqual([SLOTS_PER_DAY + 80, SLOTS_PER_DAY + 81, SLOTS_PER_DAY + 82, SLOTS_PER_DAY + 83]);
  });
});
