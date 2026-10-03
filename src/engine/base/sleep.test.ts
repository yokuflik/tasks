import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../../fixtures';
import type { ScheduleBlock } from '../../contracts';
import { rangeToAbs } from './grid';
import { prepareWeek } from './prepare';
import { nightWindow } from './sleep';
import { validateHardRules } from './hard-rules';
import { DAYS, input, shift, task, week } from './testing/helpers';

function abs(p: ReturnType<typeof prepareWeek>, b: ScheduleBlock) {
  return rangeToAbs(p.grid, b.range);
}

describe('שינה', () => {
  it('שבוע ריק: בלוק שינה רציף אחד בכל לילה, ביעד של 9 שעות, בלי דיווחים', () => {
    const s = loadScenario('empty-week');
    const p = prepareWeek(s);
    expect(p.sleepBlocks).toHaveLength(7);
    for (const b of p.sleepBlocks) expect(b.range.endMin - b.range.startMin).toBe(s.settings.targetSleepMin);
    expect(p.exceptions).toEqual({ unplaced: [], sleepShortfalls: [] });
  });

  it('כל בלוק שינה מתחיל בחלון הלילה שלו, ולילות שונים לא חופפים', () => {
    const p = prepareWeek(loadScenario('no-shifts-light'));
    p.sleepBlocks.forEach((b, i) => {
      const w = nightWindow(p.grid, DAYS[i]!);
      expect(abs(p, b).start).toBeGreaterThanOrEqual(w.startAbs);
      expect(abs(p, b).start).toBeLessThan(w.endAbs);
      if (i > 0) expect(abs(p, p.sleepBlocks[i - 1]!).end).toBeLessThanOrEqual(abs(p, b).start);
    });
  });

  it('משמרות בוקר: השינה מסתיימת לפני כל משמרת ולא נוגעת בה', () => {
    const s = loadScenario('morning-shifts');
    const p = prepareWeek(s);
    expect(p.exceptions.sleepShortfalls).toEqual([]);
    for (const sh of p.fixedBlocks) {
      const r = abs(p, sh);
      for (const sl of p.sleepBlocks) {
        const q = abs(p, sl);
        expect(q.end <= r.start || q.start >= r.end).toBe(true);
      }
    }
    for (const sl of p.sleepBlocks) expect(abs(p, sl).end - abs(p, sl).start).toBeGreaterThanOrEqual(480);
  });

  it('משמרות לילה: השינה זזה לאחרי המשמרת, לא לפניה', () => {
    const p = prepareWeek(loadScenario('night-shifts'));
    expect(p.exceptions.sleepShortfalls).toEqual([]);
    const nightShifts = p.fixedBlocks.map((b) => abs(p, b));
    expect(nightShifts).toHaveLength(4);
    nightShifts.forEach((sh, i) => {
      const sl = abs(p, p.sleepBlocks[i]!);
      expect(sl.start).toBeGreaterThanOrEqual(sh.end); // אחרי סיום המשמרת (06:00)
      expect(sl.end - sl.start).toBeGreaterThanOrEqual(480);
      expect(sl.start).toBeGreaterThanOrEqual(i * 1440 + 1440); // כבר ביום שאחרי
    });
    // ללא משמרת בלילה, השינה חוזרת ללילה (מתחילה לפני חצות של אותו לילה או אחריה, לא בצהריים)
    const free = abs(p, p.sleepBlocks[5]!);
    expect(free.start).toBeLessThan(5 * 1440 + 1440 + 360);
  });

  it('משמרת שחוצה חצות: שינה אחרי הסיום, בלי שיעורי בית חלון פעילות', () => {
    const p = prepareWeek(loadScenario('shift-crossing-midnight'));
    expect(p.exceptions.sleepShortfalls).toEqual([]);
    const sh = abs(p, p.fixedBlocks[0]!);
    expect(sh.end).toBeGreaterThan(3 * 1440); // חוצה חצות
    const night = p.sleepBlocks[2]!; // לילה של יום שלישי
    expect(abs(p, night).start).toBeGreaterThanOrEqual(sh.end);
  });

  it('שתי משמרות סמוכות שמשאירות 6 שעות: מדווח, לא שובר בשקט', () => {
    const p = prepareWeek(loadScenario('adjacent-shifts'));
    expect(p.exceptions.sleepShortfalls).toEqual([{ date: DAYS[0], availableMin: 360, requiredMin: 480 }]);
    // הלילות האחרים תקינים, והמשמרות במקומן
    expect(p.fixedBlocks).toHaveLength(2);
    const shortNight = p.sleepBlocks.find((b) => b.id === `sleep-${DAYS[0]}`)!;
    expect(shortNight.range.endMin - shortNight.range.startMin).toBe(360);
  });

  it('חלון שינה בדיוק 8 שעות מספיק; 7:45 לא', () => {
    // משמרת א מסתיימת 23:00, משמרת ב מתחילה 07:00 למחרת: 8 שעות בדיוק
    const ok = prepareWeek(input([shift('a', 0, 900, 480), shift('b', 1, 420, 480)], week({ activeDates: [DAYS[0]!, DAYS[1]!] })));
    expect(ok.exceptions.sleepShortfalls).toEqual([]);
    expect(ok.sleepBlocks[0]!.range).toEqual({ date: DAYS[0], startMin: 1380, endMin: 1860 });
    const bad = prepareWeek(input([shift('a', 0, 900, 480), shift('b', 1, 405, 480)], week({ activeDates: [DAYS[0]!, DAYS[1]!] })));
    expect(bad.exceptions.sleepShortfalls).toEqual([{ date: DAYS[0], availableMin: 465, requiredMin: 480 }]);
  });

  it('שינה חורגת מחלון הפעילות היומי (הוחלט ב-BUILD_PLAN 13)', () => {
    const dayWindows = Object.fromEntries(DAYS.map((d) => [d, { startMin: 540, endMin: 1080 }]));
    const p = prepareWeek(input([], week({ dayWindows })));
    expect(p.exceptions.sleepShortfalls).toEqual([]);
    expect(p.sleepBlocks).toHaveLength(7);
  });

  it('זמן חסום נחשב כמו משמרת: השינה נמנעת ממנו', () => {
    const blocked = [{ id: 'b', title: 'x', source: 'manual' as const, range: { date: DAYS[0]!, startMin: 1200, endMin: 1440 + 120 } }];
    const p = prepareWeek(input([], week({ blockedTimes: blocked })));
    const b = abs(p, p.sleepBlocks[0]!);
    const bt = rangeToAbs(p.grid, blocked[0]!.range);
    expect(b.start >= bt.end || b.end <= bt.start).toBe(true);
    expect(p.exceptions.sleepShortfalls).toEqual([]);
  });

  it('שינה נעולה נשמרת במקומה ולא נוצר בלוק נוסף באותו לילה', () => {
    const lockedSleep: ScheduleBlock = {
      id: 'ls',
      kind: 'sleep',
      range: { date: DAYS[1]!, startMin: 60, endMin: 60 + 540 },
      locked: true,
    };
    const p = prepareWeek(input([], week(), [lockedSleep]));
    expect(p.sleepBlocks).toHaveLength(6);
    expect(p.exceptions.sleepShortfalls).toEqual([]);
    // הבלוק הנעול הוא בלילה של יום ראשון; אין חפיפה איתו
    for (const b of p.sleepBlocks) {
      const r = abs(p, b);
      expect(r.end <= 1440 + 60 || r.start >= 1440 + 600).toBe(true);
    }
  });

  it('שינה נעולה קצרה מהמינימום מדווחת', () => {
    const locked: ScheduleBlock = { id: 'ls', kind: 'sleep', range: { date: DAYS[1]!, startMin: 60, endMin: 360 }, locked: true };
    const p = prepareWeek(input([], week(), [locked]));
    expect(p.exceptions.sleepShortfalls).toEqual([{ date: DAYS[0], availableMin: 300, requiredMin: 480 }]);
  });

  it('לילה בלי אף זמן פנוי מדווח עם 0 ובלי בלוק שינה', () => {
    const blocked = [{ id: 'all', title: 'x', source: 'manual' as const, range: { date: DAYS[0]!, startMin: 0, endMin: 2880 } }];
    const p = prepareWeek(input([], week({ activeDates: [DAYS[0]!], blockedTimes: blocked })));
    expect(p.sleepBlocks).toHaveLength(0);
    expect(p.exceptions.sleepShortfalls).toEqual([{ date: DAYS[0], availableMin: 0, requiredMin: 480 }]);
  });

  it('אין חפיפה בין שינה למשימות קבועות או חסומות, והמאמת מסכים', () => {
    for (const name of ['night-shifts', 'adjacent-shifts', 'fixed-day-sequence', 'dst-transition']) {
      const s = loadScenario(name);
      const p = prepareWeek(s);
      const v = validateHardRules({
        week: s.week,
        tasks: s.tasks,
        categories: s.categories,
        settings: s.settings,
        blocks: [...p.fixedBlocks, ...p.sleepBlocks],
        exceptions: p.exceptions,
      });
      expect(v, name).toEqual([]);
    }
  });

  it('לא תלוי בהגדרות שעות: אותם נתונים עם יעד שינה שונה נותנים בלוקים באורך היעד', () => {
    const p = prepareWeek({ ...input([]), settings: { minSleepMin: 360, targetSleepMin: 420 } });
    for (const b of p.sleepBlocks) expect(b.range.endMin - b.range.startMin).toBe(420);
  });

  it('משימה גמישה לא משפיעה על מיקום השינה (שינה קודמת לכל משימה)', () => {
    const a = prepareWeek(input([]));
    const b = prepareWeek(input([task('x'), task('y', { durationMin: 600 })]));
    expect(b.sleepBlocks).toEqual(a.sleepBlocks);
  });
});
