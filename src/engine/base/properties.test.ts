import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BlockedTime, ScheduleBlock, Task, TimeWindow, Week } from '../../contracts';
import { validateHardRules } from './hard-rules';
import { prepareWeek } from './prepare';
import type { PrepareInput } from './prepare';
import { rangeToAbs } from './grid';
import { nightWindow } from './sleep';
import { DEFAULT_CATEGORIES } from '../../contracts/defaults';
import { DAYS, START, shift, task } from './testing/helpers';

const slot = (max: number) => fc.integer({ min: 0, max }).map((n) => n * 15);

interface Gen {
  shifts: { day: number; start: number; dur: number }[];
  blocked: { day: number; start: number; dur: number }[];
  windows: (TimeWindow | null)[];
  active: boolean[];
  minSleep: number;
  extraTarget: number;
  flex: { dur: number; splittable: boolean; forbid: number[] }[];
}

const genInput = fc.record<Gen>({
  shifts: fc.array(
    fc.record({ day: fc.integer({ min: 0, max: 6 }), start: slot(95), dur: fc.integer({ min: 4, max: 48 }).map((n) => n * 15) }),
    { maxLength: 7 },
  ),
  blocked: fc.array(
    fc.record({ day: fc.integer({ min: 0, max: 6 }), start: slot(95), dur: fc.integer({ min: 1, max: 24 }).map((n) => n * 15) }),
    { maxLength: 5 },
  ),
  windows: fc.array(
    fc.option(
      fc.record({ startMin: slot(60), dur: fc.integer({ min: 4, max: 36 }).map((n) => n * 15) }).map((w) => ({ startMin: w.startMin, endMin: w.startMin + w.dur })),
      { nil: null },
    ),
    { minLength: 7, maxLength: 7 },
  ),
  active: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
  minSleep: fc.integer({ min: 24, max: 36 }).map((n) => n * 15),
  extraTarget: fc.integer({ min: 0, max: 8 }).map((n) => n * 15),
  flex: fc.array(
    fc.record({
      dur: fc.integer({ min: 1, max: 40 }).map((n) => n * 15),
      splittable: fc.boolean(),
      forbid: fc.array(fc.integer({ min: 0, max: 6 }), { maxLength: 7 }),
    }),
    { maxLength: 10 },
  ),
});

function build(g: Gen): PrepareInput {
  const activeDates = DAYS.filter((_, i) => g.active[i]);
  const dayWindows = Object.fromEntries(
    DAYS.flatMap((d, i) => (g.windows[i] && g.active[i] ? [[d, g.windows[i]!] as const] : [])),
  );
  const blockedTimes: BlockedTime[] = g.blocked.map((b, i) => ({
    id: `bt${i}`,
    title: 'b',
    source: 'manual',
    range: { date: DAYS[b.day]!, startMin: b.start, endMin: b.start + b.dur },
  }));
  const week: Week = { id: 'w', startDate: START, activeDates, dayWindows, blockedTimes, taskIds: [], schedules: [] };
  const tasks: Task[] = [
    ...g.shifts.map((s, i) => shift(`sh${i}`, s.day, s.start, s.dur)),
    ...g.flex.map((f, i) =>
      task(`f${i}`, {
        durationMin: f.dur,
        split: { splittable: f.splittable, minSegmentMin: 30 },
        constraints: { forbiddenWeekdays: [...new Set(f.forbid)] as Task['constraints']['forbiddenWeekdays'] & number[] },
        dependsOn: i > 0 && i % 3 === 0 ? [`f${i - 1}`] : [],
      }),
    ),
  ];
  return {
    week,
    tasks,
    categories: DEFAULT_CATEGORIES,
    settings: { minSleepMin: g.minSleep, targetSleepMin: g.minSleep + g.extraTarget },
  };
}

type Iv = { id: string; start: number; end: number };
function overlapPairs(ivs: Iv[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ivs.length; i++)
    for (let j = i + 1; j < ivs.length; j++) if (ivs[i]!.start < ivs[j]!.end && ivs[j]!.start < ivs[i]!.end) out.push([ivs[i]!.id, ivs[j]!.id]);
  return out;
}

describe('תכונות: לכל קלט חוקי', () => {
  const runs = { numRuns: 400 };

  it('אין חפיפות בין בלוקים, ואף בלוק לא חופף לזמן חסום', () => {
    fc.assert(
      fc.property(genInput, (g) => {
        const inp = build(g);
        const p = prepareWeek(inp);
        const blocks = [...p.fixedBlocks, ...p.sleepBlocks];
        const ivs = blocks.map((b) => ({ id: b.id, ...rangeToAbs(p.grid, b.range) }));
        expect(overlapPairs(ivs)).toEqual([]);
        for (const bt of inp.week.blockedTimes) {
          const t = rangeToAbs(p.grid, bt.range);
          for (const iv of ivs) expect(iv.start < t.end && iv.end > t.start, `${iv.id} vs ${bt.id}`).toBe(false);
        }
      }),
      runs,
    );
  });

  it('כל משמרת נשארת במקומה המדויק, או מדווחת כהתנגשות; ובלי התנגשויות כולן במקומן', () => {
    fc.assert(
      fc.property(genInput, (g) => {
        const inp = build(g);
        const p = prepareWeek(inp);
        const unplaced = new Map(p.exceptions.unplaced.map((u) => [u.taskId, u.reason]));
        for (const t of inp.tasks.filter((x) => x.flexibility === 'fixed')) {
          const b = p.fixedBlocks.find((x) => x.taskId === t.id);
          if (b) {
            expect(b.range).toEqual({ date: t.constraints.fixedDate, startMin: t.constraints.fixedStartMin, endMin: t.constraints.fixedStartMin! + t.durationMin });
            expect(unplaced.has(t.id)).toBe(false);
          } else {
            expect(unplaced.get(t.id)).toBe('fixed_conflict');
          }
        }
        // קלט בלי חפיפות בין משמרות, זמנים חסומים או ימים לא פעילים: כולן משובצות
        const shiftIvs = inp.tasks
          .filter((t) => t.flexibility === 'fixed')
          .map((t) => ({ id: t.id, start: DAYS.indexOf(t.constraints.fixedDate!) * 1440 + t.constraints.fixedStartMin!, end: DAYS.indexOf(t.constraints.fixedDate!) * 1440 + t.constraints.fixedStartMin! + t.durationMin }));
        const blockedIvs = inp.week.blockedTimes.map((b) => ({ id: b.id, ...rangeToAbs(p.grid, b.range) }));
        const clean =
          overlapPairs([...shiftIvs, ...blockedIvs]).length === 0 &&
          inp.tasks.filter((t) => t.flexibility === 'fixed').every((t) => inp.week.activeDates.includes(t.constraints.fixedDate!));
        if (clean) expect([...unplaced.values()].filter((r) => r === 'fixed_conflict')).toEqual([]);
      }),
      runs,
    );
  });

  it('כל לילה פעיל מכיל שינה רציפה של לפחות המינימום, או דוח ששמו את הלילה והמספרים נכונים', () => {
    fc.assert(
      fc.property(genInput, (g) => {
        const inp = build(g);
        const p = prepareWeek(inp);
        const min = inp.settings.minSleepMin;
        const shortBy = new Map(p.exceptions.sleepShortfalls.map((s) => [s.date, s]));
        for (const date of inp.week.activeDates) {
          const w = nightWindow(p.grid, date);
          const inNight = p.sleepBlocks.filter((b) => {
            const s = rangeToAbs(p.grid, b.range).start;
            return s >= w.startAbs && s < w.endAbs;
          });
          expect(inNight.length).toBeLessThanOrEqual(1);
          const len = inNight[0] ? rangeToAbs(p.grid, inNight[0].range).end - rangeToAbs(p.grid, inNight[0].range).start : 0;
          const rep = shortBy.get(date);
          if (len >= min) {
            expect(rep, `${date} דווח למרות שינה מספקת`).toBeUndefined();
          } else {
            expect(rep, `${date} חסרה שינה ואין דוח`).toBeDefined();
            expect(rep!.requiredMin).toBe(min);
            expect(rep!.availableMin).toBeLessThan(min);
            expect(rep!.availableMin).toBe(len);
          }
          if (inNight[0]) expect(len).toBeLessThanOrEqual(inp.settings.targetSleepMin);
        }
        expect(p.exceptions.sleepShortfalls.length).toBeLessThanOrEqual(inp.week.activeDates.length);
      }),
      runs,
    );
  });

  it('בלי משמרות ובלי זמנים חסומים: אין שום חוסר שינה, לא משנה החלונות והמשימות', () => {
    fc.assert(
      fc.property(genInput, (g) => {
        const p = prepareWeek(build({ ...g, shifts: [], blocked: [] }));
        expect(p.exceptions.sleepShortfalls).toEqual([]);
      }),
      runs,
    );
  });

  it('המאמת מסכים עם הפלט, והפלט דטרמיניסטי', () => {
    fc.assert(
      fc.property(genInput, (g) => {
        const inp = build(g);
        const p = prepareWeek(inp);
        const blocks: ScheduleBlock[] = [...p.fixedBlocks, ...p.sleepBlocks];
        const v = validateHardRules({ ...inp, week: inp.week, blocks, exceptions: p.exceptions });
        expect(v).toEqual([]);
        expect(prepareWeek(inp)).toEqual(p);
      }),
      runs,
    );
  });

  it('משימה שלא ניתנת לשיבוץ בדוח לעולם לא ברשימת הניתנות לשיבוץ, ולהפך', () => {
    fc.assert(
      fc.property(genInput, (g) => {
        const inp = build(g);
        const p = prepareWeek(inp);
        const bad = new Set(p.exceptions.unplaced.map((u) => u.taskId));
        for (const t of p.schedulable) expect(bad.has(t.id)).toBe(false);
        const accounted = new Set([...bad, ...p.schedulable.map((t) => t.id), ...p.fixedBlocks.map((b) => b.taskId!)]);
        for (const t of inp.tasks) expect(accounted.has(t.id), t.id).toBe(true);
      }),
      runs,
    );
  });
});
