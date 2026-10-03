import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addDays, dateRange, diffDays, isValidIsoDate, nextWeekStart, prevWeekStart,
  shiftWeek, weekDates, weekdayOf, weekStartOf,
} from './index';

describe('שבוע שמתחיל ביום ראשון', () => {
  it('weekdayOf: 0 = ראשון, 6 = שבת', () => {
    expect(weekdayOf('2026-10-04')).toBe(0); // ראשון
    expect(weekdayOf('2026-10-10')).toBe(6); // שבת
    expect(weekdayOf('2026-10-03')).toBe(6);
  });

  it('weekStartOf מחזיר את יום ראשון שלפני או באותו יום', () => {
    expect(weekStartOf('2026-10-04')).toBe('2026-10-04');
    expect(weekStartOf('2026-10-10')).toBe('2026-10-04');
    expect(weekStartOf('2026-10-03')).toBe('2026-09-27');
  });

  it('weekDates: שבעה ימים רצופים מראשון עד שבת', () => {
    const w = weekDates('2026-10-07');
    expect(w).toHaveLength(7);
    expect(w[0]).toBe('2026-10-04');
    expect(w[6]).toBe('2026-10-10');
    expect(w.map(weekdayOf)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('מעבר שבועות קדימה ואחורה', () => {
    expect(nextWeekStart('2026-10-07')).toBe('2026-10-11');
    expect(prevWeekStart('2026-10-07')).toBe('2026-09-27');
    expect(shiftWeek('2026-10-07', 5)).toBe('2026-11-08');
    expect(shiftWeek('2026-10-07', 0)).toBe('2026-10-04');
  });
});

describe('סוף שנה וגבולות', () => {
  it('שבוע שחוצה את סוף השנה הלועזית', () => {
    // 31.12.2026 הוא חמישי
    expect(weekStartOf('2026-12-31')).toBe('2026-12-27');
    expect(weekDates('2026-12-31')).toEqual([
      '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ]);
    expect(nextWeekStart('2026-12-31')).toBe('2027-01-03');
  });

  it('שנה מעוברת', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(weekDates('2028-02-29')[0]).toBe('2028-02-27');
  });

  it('שבוע שמתחיל ביום ראשון שהוא 1 בינואר', () => {
    expect(weekStartOf('2023-01-01')).toBe('2023-01-01');
    expect(weekStartOf('2022-12-31')).toBe('2022-12-25');
  });

  it('diffDays ו-dateRange', () => {
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
    expect(diffDays('2027-01-02', '2026-12-30')).toBe(-3);
    expect(dateRange('2026-12-30', '2027-01-01')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(dateRange('2026-01-02', '2026-01-01')).toEqual([]);
  });

  it('תאריכים לא תקינים נדחים', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-2-3')).toBe(false);
    expect(isValidIsoDate('2026-10-04')).toBe(true);
    expect(() => weekdayOf('2026-13-01')).toThrow(RangeError);
  });
});

describe('תכונות', () => {
  const dateArb = fc.date({ min: new Date('2000-01-01'), max: new Date('2060-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10));

  it('כל תאריך שייך לשבוע שלו, והשבוע מתחיל בראשון', () => {
    fc.assert(
      fc.property(dateArb, (d) => {
        const start = weekStartOf(d);
        expect(weekdayOf(start)).toBe(0);
        expect(weekDates(d)).toContain(d);
        expect(diffDays(start, d)).toBeGreaterThanOrEqual(0);
        expect(diffDays(start, d)).toBeLessThan(7);
      }),
    );
  });

  it('קדימה ואחורה מחזירים לאותה נקודה', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -2000, max: 2000 }), (d, n) => {
        expect(addDays(addDays(d, n), -n)).toBe(d);
        expect(shiftWeek(shiftWeek(d, n), -n)).toBe(weekStartOf(d));
      }),
    );
  });
});
