import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../../fixtures';
import { validateHardRules } from './hard-rules';
import { isMandatoryTask } from './feasibility';
import { prepareWeek } from './prepare';
import { rangeToAbs } from './grid';
import { DEFAULT_CATEGORIES } from '../../contracts/defaults';
import { DAYS, input, shift, task, week } from './testing/helpers';

const doctor = (id: string, day: number, start: number, dur = 60) =>
  task(id, { categoryId: 'health', durationMin: dur, constraints: { fixedDate: DAYS[day]!, fixedStartMin: start } });

describe('העדפת שינה: 23:00, ואחרי משמרת לילה מיד אחריה', () => {
  it('בלי משמרות ומשימות: כל לילה מתחיל ב-23:00 ונמשך 9 שעות', () => {
    const p = prepareWeek(input([]));
    p.sleepBlocks.forEach((b) => {
      expect(b.range.startMin).toBe(1380);
      expect(b.range.endMin - b.range.startMin).toBe(540);
    });
    expect(p.sleepWarnings).toEqual([]);
  });

  it('משימות גמישות לא מזיזות את השינה מ-23:00', () => {
    const p = prepareWeek(input([task('x'), task('y', { durationMin: 300 })]));
    expect(p.sleepBlocks.every((b) => b.range.startMin === 1380)).toBe(true);
  });

  it('משמרת לילה שמסתיימת 07:30: השינה מתחילה בדיוק ב-07:30', () => {
    const p = prepareWeek(input([shift('n', 0, 1350, 540)]));
    expect(p.sleepBlocks[0]!.range).toEqual({ date: DAYS[1], startMin: 450, endMin: 450 + 540 });
    // לילות בלי משמרת חוזרים ל-23:00
    expect(p.sleepBlocks[3]!.range.startMin).toBe(1380);
  });

  it('משמרות לילה של התרחיש: כל שינה מתחילה ברגע סיום המשמרת', () => {
    const p = prepareWeek(loadScenario('night-shifts'));
    p.fixedBlocks.forEach((b, i) => {
      expect(rangeToAbs(p.grid, p.sleepBlocks[i]!.range).start).toBe(rangeToAbs(p.grid, b.range).end);
    });
  });

  it('משמרת בוקר מקצרת ל-8 שעות מ-23:00 במקום להקדים', () => {
    const p = prepareWeek(input([shift('m', 1, 420, 480)], week({ activeDates: [DAYS[0]!, DAYS[1]!] })));
    expect(p.sleepBlocks[0]!.range).toEqual({ date: DAYS[0], startMin: 1380, endMin: 1380 + 480 });
    expect(p.sleepWarnings).toEqual([]);
  });
});

describe('חובות (עבודה ורופאים) פוגעות בשינה אבל מתריעות', () => {
  it('תור רפואי עם זמן קבוע הוא חובה וקבוע; בריאות בלי זמן קבוע היא גמישה', () => {
    expect(isMandatoryTask(doctor('d', 1, 600), DEFAULT_CATEGORIES)).toBe(true);
    expect(isMandatoryTask(task('h', { categoryId: 'health' }), DEFAULT_CATEGORIES)).toBe(false);
    expect(isMandatoryTask(task('e'), DEFAULT_CATEGORIES)).toBe(false);
  });

  it('תור בחצות נשאר במקומו, פוגע בשינה, ומתריע עם שם התור', () => {
    // תור 23:30-01:30: שאר הלילה (עד 06:00 משמרת) קצר מ-8 שעות
    const w = week({ activeDates: [DAYS[0]!, DAYS[1]!] });
    const p = prepareWeek(input([doctor('doc', 0, 1410, 120), shift('early', 1, 360, 480)], w));
    expect(p.fixedBlocks.map((b) => b.taskId).sort()).toEqual(['doc', 'early']);
    expect(p.exceptions.unplaced).toEqual([]);
    expect(p.exceptions.sleepShortfalls).toHaveLength(1);
    const warn = p.sleepWarnings[0]!;
    expect(warn.date).toBe(DAYS[0]);
    expect(warn.mandatoryTaskIds.sort()).toEqual(['doc', 'early']);
    expect(warn.message).toContain('שעות שינה');
    // האזהרה מכשירה את הלילה אצל המאמת
    const v = validateHardRules({
      week: w,
      tasks: [doctor('doc', 0, 1410, 120), shift('early', 1, 360, 480)],
      categories: DEFAULT_CATEGORIES,
      settings: { minSleepMin: 480 },
      blocks: [...p.fixedBlocks, ...p.sleepBlocks],
      exceptions: p.exceptions,
    });
    expect(v).toEqual([]);
  });

  it('משימה גמישה לעולם לא גורמת לחוסר שינה, וחובות לא נמחקות בשבילה', () => {
    const p = prepareWeek(input([doctor('doc', 2, 1200, 60), task('big', { durationMin: 1440 })]));
    expect(p.fixedBlocks.map((b) => b.taskId)).toEqual(['doc']);
    expect(p.sleepWarnings).toEqual([]);
  });

  it('משמרות סמוכות: האזהרה מונה את שתי המשמרות', () => {
    const p = prepareWeek(loadScenario('adjacent-shifts'));
    expect(p.sleepWarnings).toHaveLength(1);
    expect(p.sleepWarnings[0]!.mandatoryTaskIds.sort()).toEqual(['s-mon', 's-sun']);
    expect(p.sleepWarnings[0]!.availableMin).toBe(360);
  });

  it('תור רפואי שחופף למשמרת: לא נבלע, מדווח כהתנגשות קבועה', () => {
    const p = prepareWeek(input([shift('s', 0, 540, 480), doctor('doc', 0, 600)]));
    expect(p.exceptions.unplaced.map((u) => [u.taskId, u.reason])).toEqual([['doc', 'fixed_conflict']]);
  });
});
