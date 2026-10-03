import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  elapsedMinutes, endWallMinute, instantToWall, isWallTimeValid, minutesInDay, todayIso,
  utcOffsetMinutes, wallToInstant,
} from './index';

const TZ = 'Asia/Jerusalem';

describe('היסט אזור זמן', () => {
  it('חורף UTC+2, קיץ UTC+3', () => {
    expect(utcOffsetMinutes(new Date('2026-01-15T12:00:00Z'), TZ)).toBe(120);
    expect(utcOffsetMinutes(new Date('2026-07-15T12:00:00Z'), TZ)).toBe(180);
  });
});

describe('מעבר שעון קיץ (שישי 27.3.2026: 02:00 הופך ל-03:00)', () => {
  it('אורך היום: 1380 בקיץ, 1500 בחורף, 1440 ברגיל', () => {
    expect(minutesInDay('2026-03-27', TZ)).toBe(1380);
    expect(minutesInDay('2026-10-25', TZ)).toBe(1500);
    expect(minutesInDay('2026-03-26', TZ)).toBe(1440);
    expect(minutesInDay('2026-03-28', TZ)).toBe(1440);
  });

  it('משימה מ-00:30 למשך 120 דקות אמיתיות מסתיימת ב-03:30 בשעון הקיר', () => {
    expect(endWallMinute('2026-03-27', 30, 120, TZ)).toBe(210);
    expect(elapsedMinutes('2026-03-27', 30, 210, TZ)).toBe(120);
  });

  it('אותה משימה ביום רגיל מסתיימת ב-02:30', () => {
    expect(endWallMinute('2026-03-26', 30, 120, TZ)).toBe(150);
  });

  it('endWallMinute חוצה חצות ונשאר על תאריך ההתחלה', () => {
    expect(endWallMinute('2026-06-10', 23 * 60, 180, TZ)).toBe(26 * 60);
    expect(endWallMinute('2026-10-24', 23 * 60, 180, TZ)).toBe(25 * 60); // חזרה לחורף: 01:00 בפעם השנייה
  });

  it('אותה משימה ביום רגיל נמשכת 120 דקות', () => {
    expect(elapsedMinutes('2026-03-26', 30, 150, TZ)).toBe(120);
  });

  it('שעה שלא קיימת: 02:30 נפתרת קדימה ל-03:30', () => {
    expect(isWallTimeValid('2026-03-27', 150, TZ)).toBe(false);
    expect(isWallTimeValid('2026-03-27', 119, TZ)).toBe(true);
    expect(isWallTimeValid('2026-03-27', 180, TZ)).toBe(true);
    const inst = wallToInstant('2026-03-27', 150, TZ);
    expect(instantToWall(inst, TZ)).toEqual({ date: '2026-03-27', min: 210 });
  });

  it('חצות לילה שחוצה את המעבר', () => {
    // לילה של 26 ל-27 במרץ: מ-23:00 ועד 05:00 שעון קיר = 6 שעות קיר, 5 בפועל
    expect(elapsedMinutes('2026-03-26', 23 * 60, 29 * 60, TZ)).toBe(5 * 60);
  });
});

describe('חזרה לשעון חורף (ראשון 25.10.2026: 02:00 הופך ל-01:00)', () => {
  it('לילה של 25.10 נמשך שעה יותר', () => {
    expect(elapsedMinutes('2026-10-25', 0, 8 * 60, TZ)).toBe(9 * 60);
  });

  it('שעה כפולה: 01:30 נפתרת להופעה הראשונה (שעון קיץ)', () => {
    const inst = wallToInstant('2026-10-25', 90, TZ);
    expect(inst.toISOString()).toBe('2026-10-24T22:30:00.000Z');
    expect(isWallTimeValid('2026-10-25', 90, TZ)).toBe(true);
  });
});

describe('המרות', () => {
  it('הלוך ושוב ביום רגיל', () => {
    const inst = wallToInstant('2026-06-10', 14 * 60 + 15, TZ);
    expect(inst.toISOString()).toBe('2026-06-10T11:15:00.000Z');
    expect(instantToWall(inst, TZ)).toEqual({ date: '2026-06-10', min: 14 * 60 + 15 });
  });

  it('min מעל 1440 עובר ליום הבא', () => {
    const inst = wallToInstant('2026-06-10', 1440 + 60, TZ);
    expect(instantToWall(inst, TZ)).toEqual({ date: '2026-06-11', min: 60 });
  });

  it('todayIso לפי אזור הזמן ולא לפי UTC', () => {
    // 22:30 UTC בחורף = 00:30 למחרת בירושלים
    const now = new Date('2026-01-14T22:30:00Z');
    expect(todayIso(TZ, now)).toBe('2026-01-15');
    expect(todayIso('UTC', now)).toBe('2026-01-14');
    expect(todayIso('America/New_York', now)).toBe('2026-01-14');
  });

  it('אזור זמן אחר: ניו יורק מזיז את המעבר ליום אחר', () => {
    expect(minutesInDay('2026-03-08', 'America/New_York')).toBe(1380);
    expect(minutesInDay('2026-03-27', 'America/New_York')).toBe(1440);
  });
});

describe('תכונות', () => {
  it('הלוך ושוב על שעות קיימות נותן אותה שעת קיר', () => {
    const dateArb = fc.date({ min: new Date('2024-01-01'), max: new Date('2035-12-31'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 0, max: 1439 }), (date, min) => {
        fc.pre(isWallTimeValid(date, min, TZ));
        // שעה כפולה נפתרת להופעה הראשונה, אך שעת הקיר חוזרת זהה
        expect(instantToWall(wallToInstant(date, min, TZ), TZ)).toEqual({ date, min });
      }),
      { numRuns: 500 },
    );
  });

  it('אורך כל יום הוא 1380, 1440 או 1500', () => {
    for (let day = 0; day < 366; day++) {
      const d = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      expect([1380, 1440, 1500]).toContain(minutesInDay(d, TZ));
    }
  });
});
