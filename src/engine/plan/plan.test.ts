import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadScenarios } from '../../../fixtures';
import { DEFAULT_CATEGORIES } from '../../contracts/defaults';
import type { Schedule, ScheduleBlock } from '../../contracts';
import { rangeToAbs, validateHardRules } from '../base';
import { buildPlan, generateSchedule, generateSchedules, regenerate } from './generate';
import type { GenerateInput } from './generate';
import { MIN_VARIATION_DISTANCE, scheduleDistance } from './distance';
import { improve } from './improve';
import { greedyPlace, orderTasks } from './place';
import type { PlanState } from './place';
import { PERSONALITIES } from './personalities';
import { makeRng } from './rng';
import { evaluate } from './score';
import type { Piece } from './types';
import { handleRequest } from './worker';
import { bigWeek, DAYS, fromScenario, inputOf, shift, task, week } from './testing';

const scenarios = loadScenarios();

function violations(input: GenerateInput, s: Schedule) {
  return validateHardRules({
    week: input.week,
    tasks: input.tasks,
    categories: input.categories,
    settings: input.settings,
    blocks: s.blocks,
    exceptions: s.exceptions,
    requireAllAccounted: true,
  });
}

const taskBlocks = (s: Schedule, id: string): ScheduleBlock[] => s.blocks.filter((b) => b.taskId === id);
const placedIds = (s: Schedule): Set<string> => new Set(s.blocks.filter((b) => b.kind === 'task').map((b) => b.taskId!));

describe('דטרמיניזם וזרע', () => {
  it('אותו קלט ואותו זרע נותנים אותה תוצאה בדיוק', () => {
    const input = bigWeek(30);
    expect(generateSchedules({ ...input, seed: 5 })).toEqual(generateSchedules({ ...input, seed: 5 }));
  });

  it('הזרע בפועל נשמר ומשחזר את אותו סידור', () => {
    const input = bigWeek(25);
    for (const s of generateSchedules(input).schedules) {
      expect(generateSchedule(input, s.personality, s.seed)).toEqual(s);
    }
  });

  it('הפקה מחדש נותנת זרע אחר, וסידורים תקינים', () => {
    const input = bigWeek(25);
    const first = generateSchedules(input);
    const again = regenerate(input, first);
    expect(again.seed).not.toBe(first.seed);
    for (const s of again.schedules) expect(violations(input, s)).toEqual([]);
  });
});

describe('שלוש וריאציות', () => {
  it('שלוש אישיויות בסדר הנכון, כל אחת עם ציון ופירוט', () => {
    const set = generateSchedules(bigWeek(25));
    expect(set.schedules.map((s) => s.personality)).toEqual(['balanced', 'early', 'themed']);
    for (const s of set.schedules) {
      expect(s.score.total).toBeGreaterThan(0);
      expect(s.score.total).toBeLessThanOrEqual(100);
      expect(s.score.totalCount).toBe(s.score.placedCount + s.exceptions.unplaced.length);
      expect(Object.keys(s.score.penalties).length).toBeGreaterThanOrEqual(10);
    }
  });

  it.each([15, 30, 45, 60])('שבוע של %i משימות: כל זוג שונה מעל הסף', (n) => {
    const set = generateSchedules(bigWeek(n));
    expect(set.distanceEnforced).toBe(true);
    for (const p of set.pairs) expect(p.distance).toBeGreaterThanOrEqual(MIN_VARIATION_DISTANCE);
  });

  it('מרחק: סידור זהה הוא 0, ובלוק שזז יום נספר', () => {
    const s = generateSchedules(bigWeek(20)).schedules[0]!;
    expect(scheduleDistance(s, s)).toBe(0);
    const moved: Schedule = {
      ...s,
      blocks: s.blocks.map((b, i) =>
        i === s.blocks.findIndex((x) => x.kind === 'task' && !x.locked && x.taskId!.startsWith('t'))
          ? { ...b, range: { ...b.range, date: DAYS[(DAYS.indexOf(b.range.date) + 1) % 7]! } }
          : b,
      ),
    };
    expect(scheduleDistance(s, moved)).toBeGreaterThan(0);
  });

  it('מאוזן מפזר עומס אחיד יותר ממוקדם, ומוקדם מקדים משימות דחופות', () => {
    const input = bigWeek(30);
    const { schedules } = generateSchedules(input);
    const [balanced, early] = schedules as [Schedule, Schedule, Schedule];
    expect(balanced.score.maxDayLoadMin).toBeLessThanOrEqual(early.score.maxDayLoadMin);
    const meanStart = (s: Schedule): number => {
      const hi = input.tasks.filter((t) => t.priority === 'high' && t.flexibility !== 'fixed').map((t) => t.id);
      const starts = s.blocks.filter((b) => hi.includes(b.taskId ?? '')).map((b) => rangeToAbs({ originDate: input.week.startDate } as never, b.range).start);
      return starts.reduce((a, b) => a + b, 0) / starts.length;
    };
    expect(meanStart(early)).toBeLessThan(meanStart(balanced));
  });

  it('נושאי יום: פחות קטגוריות שונות בכל יום מאשר מאוזן', () => {
    const input = bigWeek(40);
    const { schedules } = generateSchedules(input);
    const cat = new Map(input.tasks.map((t) => [t.id, t.categoryId]));
    const spread = (s: Schedule): number => {
      const days = new Map<string, Set<string>>();
      for (const b of s.blocks) {
        if (b.kind !== 'task' || cat.get(b.taskId!) === 'work') continue;
        days.set(b.range.date, (days.get(b.range.date) ?? new Set()).add(cat.get(b.taskId!)!));
      }
      return [...days.values()].reduce((a, v) => a + v.size, 0);
    };
    expect(spread(schedules[2]!)).toBeLessThan(spread(schedules[0]!));
  });
});

describe('חוקים קשיחים בכל וריאציה', () => {
  it.each(Object.keys(scenarios))('תרחיש %s: אין הפרות, משמרות במקומן', (name) => {
    const input = fromScenario(scenarios[name]!);
    for (const s of generateSchedules(input).schedules) expect(violations(input, s)).toEqual([]);
  });

  it.each(Object.keys(scenarios))('תרחיש %s: צפיות התרחיש מתקיימות', (name) => {
    const sc = scenarios[name]!;
    for (const s of generateSchedules(fromScenario(sc)).schedules) {
      const ids = placedIds(s);
      for (const id of sc.expect.placedTaskIds ?? []) expect(ids.has(id)).toBe(true);
      for (const u of sc.expect.unplaced ?? []) {
        expect(s.exceptions.unplaced.find((x) => x.taskId === u.taskId)?.reason).toBe(u.reason);
      }
      // overloaded-week בלי dayWindows: 70 שעות נכנסות בשבוע פתוח של 24 שעות ביום. הבדיקה המקבילה בהמשך מצמצמת חלונות.
      if (sc.expect.minUnplacedCount && name !== 'overloaded-week') expect(s.exceptions.unplaced.length).toBeGreaterThanOrEqual(sc.expect.minUnplacedCount);
      expect(new Set(s.exceptions.sleepShortfalls.map((x) => x.date))).toEqual(new Set(sc.expect.sleepShortfallDates ?? []));
    }
  });

  it('שבוע עמוס מדי (חלונות של 8 שעות): חלק נדחה עם סיבה, והשאר תקין', () => {
    const sc = scenarios['overloaded-week']!;
    const dayWindows = Object.fromEntries(sc.week.activeDates.map((d) => [d, { startMin: 8 * 60, endMin: 16 * 60 }]));
    const input = fromScenario({ ...sc, week: { ...sc.week, dayWindows } });
    for (const s of generateSchedules(input).schedules) {
      expect(s.exceptions.unplaced).toHaveLength(7);
      expect(s.exceptions.unplaced.every((u) => u.reason === 'not_enough_time')).toBe(true);
      expect(s.score.placedCount).toBe(7);
      expect(violations(input, s)).toEqual([]);
    }
  });

  it('משימות שאינן עבודה לא נקבעות אחרי 23:00 או לפני 08:00 כשיש ברירה', () => {
    for (const [name, sc] of Object.entries(scenarios)) {
      const input = fromScenario(sc);
      for (const s of generateSchedules(input).schedules) {
        if (s.exceptions.unplaced.length > 0) continue;
        for (const b of s.blocks) {
          if (b.kind !== 'task') continue;
          const t = input.tasks.find((x) => x.id === b.taskId);
          if (t?.categoryId === 'work' || t?.constraints.allowedWindow || t?.constraints.fixedStartMin !== undefined) continue;
          expect(b.range.startMin, `${name} ${t?.id}`).toBeGreaterThanOrEqual(480);
          expect(b.range.endMin, `${name} ${t?.id}`).toBeLessThanOrEqual(1380);
        }
      }
    }
  });

  it('ריפוד נסיעה: בין משימות עם נסיעה נשאר מרווח לפחות כפול הנסיעה, ובלי הפרות', () => {
    const input = inputOf([1, 2, 3, 4, 5].map((i) => task(`t${i}`, { travelMin: 20, durationMin: 120 })));
    for (const s of generateSchedules(input).schedules) {
      expect(violations(input, s)).toEqual([]);
      const list = s.blocks.filter((b) => b.kind === 'task').map((b) => rangeToAbs(buildPlan(input, 'balanced').prep.grid, b.range)).sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) expect(list[i]!.start - list[i - 1]!.end).toBeGreaterThanOrEqual(40);
    }
  });

  it('שבוע ריק: רק שינה', () => {
    for (const s of generateSchedules(inputOf([])).schedules) {
      expect(s.blocks.every((b) => b.kind === 'sleep')).toBe(true);
      expect(s.exceptions.unplaced).toEqual([]);
    }
  });

  it('מבוסס תכונות: קלט אקראי חוקי נותן סידורים בלי הפרות', () => {
    const arbTask = fc.record({
      dur: fc.integer({ min: 1, max: 8 }).map((n) => n * 30),
      cat: fc.constantFrom('study', 'fitness', 'errands', 'home', 'family'),
      prio: fc.constantFrom('low', 'medium', 'high' as const),
      times: fc.integer({ min: 1, max: 3 }),
      split: fc.boolean(),
      noDay: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
      due: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
      dep: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(arbTask, { maxLength: 14 }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 1, max: 99 }), (rows, shifts, seed) => {
        const tasks = [
          ...Array.from({ length: shifts }, (_, i) => shift(`s${i}`, i * 2, 9 * 60 + i * 120, 480)),
          ...rows.map((r, i) =>
            task(`x${i}`, {
              durationMin: r.dur,
              categoryId: r.cat,
              priority: r.prio,
              timesPerWeek: r.times,
              split: { splittable: r.split, minSegmentMin: 30 },
              constraints: r.noDay !== undefined ? { forbiddenWeekdays: [r.noDay as 0] } : {},
              ...(r.due !== undefined ? { dueDate: DAYS[r.due]! } : {}),
              dependsOn: r.dep && i > 0 ? [`x${i - 1}`] : [],
            }),
          ),
        ];
        const input = inputOf(tasks, { seed });
        for (const s of generateSchedules(input).schedules) {
          if (violations(input, s).length > 0) return false;
        }
        return true;
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});

describe('דוח חריגים: סיבות נכונות', () => {
  const tinyDays = (minutes: number) =>
    week({ dayWindows: Object.fromEntries(DAYS.map((d) => [d, { startMin: 9 * 60, endMin: 9 * 60 + minutes }])) });

  it('אין מספיק זמן', () => {
    const input = inputOf(
      Array.from({ length: 9 }, (_, i) => task(`a${i}`, { durationMin: 60 })),
      { week: tinyDays(60) },
    );
    for (const s of generateSchedules(input).schedules) {
      expect(s.exceptions.unplaced).toHaveLength(2);
      expect(s.exceptions.unplaced.every((u) => u.reason === 'not_enough_time' && !!u.suggestion)).toBe(true);
      expect(violations(input, s)).toEqual([]);
    }
  });

  it('התנגשות עם תאריך יעד', () => {
    const input = inputOf(
      [
        task('due1', { priority: 'high', dueDate: DAYS[0]! }),
        task('due2', { priority: 'high', dueDate: DAYS[0]! }),
      ],
      { week: tinyDays(60) },
    );
    for (const s of generateSchedules(input).schedules) {
      expect(s.exceptions.unplaced).toHaveLength(1);
      expect(s.exceptions.unplaced[0]!.reason).toBe('deadline_conflict');
    }
  });

  it('משימה שתלויה בלא משובצת מדווחת עם הקשר', () => {
    const input = inputOf(
      [task('big', { durationMin: 90 }), task('after', { dependsOn: ['big'] })],
      { week: tinyDays(60) },
    );
    for (const s of generateSchedules(input).schedules) {
      expect(s.exceptions.unplaced.find((u) => u.taskId === 'big')?.reason).toBe('larger_than_any_window');
      expect(s.exceptions.unplaced.find((u) => u.taskId === 'after')).toMatchObject({ reason: 'dependency_unplaced', relatedTaskIds: ['big'] });
    }
  });

  it('תלות מעגלית: עוצר עם דוח, השאר משובץ', () => {
    const input = fromScenario(scenarios['circular-dependency']!);
    for (const s of generateSchedules(input).schedules) {
      expect(s.exceptions.unplaced.map((u) => u.reason)).toEqual(['circular_dependency', 'circular_dependency', 'circular_dependency']);
      expect(placedIds(s).has('t-free')).toBe(true);
    }
  });
});

describe('תלויות וחזרתיות', () => {
  it('שרשרת תלויות מסודרת בסדר, גם בשבוע עמוס', () => {
    const chain = Array.from({ length: 5 }, (_, i) => task(`c${i}`, { durationMin: 90, dependsOn: i ? [`c${i - 1}`] : [] }));
    const input = inputOf([...bigWeek(25).tasks, ...chain]);
    for (const s of generateSchedules(input).schedules) {
      const grid = { originDate: input.week.startDate } as never;
      let prevEnd = -1;
      for (let i = 0; i < 5; i++) {
        const blocks = taskBlocks(s, `c${i}`).map((b) => rangeToAbs(grid, b.range));
        if (blocks.length === 0) continue; // לא נכנסה: חייבת להופיע בדוח (נבדק ב-violations)
        expect(Math.min(...blocks.map((b) => b.start))).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = Math.max(...blocks.map((b) => b.end));
      }
      expect(violations(input, s)).toEqual([]);
    }
  });

  it('משימה חוזרת: כל מופע ביום אחר', () => {
    for (const times of [3, 5, 7]) {
      const input = inputOf([task('gym', { categoryId: 'fitness', timesPerWeek: times, durationMin: 60 }), ...bigWeek(15).tasks.slice(3)]);
      for (const s of generateSchedules(input).schedules) {
        const days = taskBlocks(s, 'gym').map((b) => b.range.date);
        expect(days).toHaveLength(times);
        expect(new Set(days).size).toBe(times);
      }
    }
  });
});

describe('שבת וחגים אינם משפיעים', () => {
  it('שבוע שכולו חג: אותו שיבוץ כמו שבוע רגיל באותם ימי השבוע, ושבת מותרת', () => {
    const sc = scenarios['holiday-midweek']!;
    const input = fromScenario(sc);
    // המנוע לא מקבל ימים מיוחדים כלל: התוצאה זהה גם אם נשנה אותם
    const a = generateSchedules(input);
    const b = generateSchedules(fromScenario({ ...sc, specialDays: [] }));
    expect(a).toEqual(b);
    for (const s of a.schedules) for (const id of sc.expect.placedTaskIds ?? []) expect(placedIds(s).has(id)).toBe(true);
  });

  it('יום פעיל יחיד שהוא שבת: משימות משובצות בו', () => {
    const sat = DAYS[6]!;
    const input = inputOf([task('x'), task('y')], { week: week({ activeDates: [sat] }) });
    for (const s of generateSchedules(input).schedules) {
      expect(taskBlocks(s, 'x')[0]!.range.date).toBe(sat);
      expect(taskBlocks(s, 'y')[0]!.range.date).toBe(sat);
    }
  });
});

describe('בלוקים נעולים', () => {
  it('נשארים במקומם והשאר מסתדר סביבם', () => {
    const lockedBlock: ScheduleBlock = {
      id: 'lk', kind: 'task', taskId: 'x', segment: 0, locked: true,
      range: { date: DAYS[1]!, startMin: 600, endMin: 660 },
    };
    const input = inputOf([task('x'), task('y'), task('z')], { lockedBlocks: [lockedBlock] });
    for (const s of generateSchedules(input).schedules) {
      expect(s.blocks.find((b) => b.id === 'lk')).toEqual(lockedBlock);
      expect(taskBlocks(s, 'x')).toHaveLength(1);
      expect(violations(input, s)).toEqual([]);
    }
  });
});

describe('ציון ושיפור מקומי', () => {
  const state = (input: GenerateInput, p: (typeof PERSONALITIES)[number] = 'balanced'): PlanState => {
    const plan = buildPlan(input, p);
    return { ctx: plan.ctx, pieces: plan.pieces, unplaced: new Map() };
  };
  const piece = (taskId: string, day: number, startMin: number, dur: number, over: Partial<Piece> = {}): Piece => ({
    id: `${taskId}-${day}-${startMin}`, taskId, segment: 0, occurrence: 0,
    start: day * 1440 + startMin, end: day * 1440 + startMin + dur, movable: true, ...over,
  });

  it('עומס מאוזן מקבל קנס נמוך מעומס מרוכז', () => {
    const input = inputOf([task('a'), task('b'), task('c'), task('d')]);
    const st = state(input);
    const spread = ['a', 'b', 'c', 'd'].map((id, i) => piece(id, i, 600, 60));
    const piled = ['a', 'b', 'c', 'd'].map((id, i) => piece(id, 0, 600 + i * 120, 60));
    expect(evaluate(st.ctx, spread).raw.loadBalance).toBeLessThan(evaluate(st.ctx, piled).raw.loadBalance);
  });

  it('בלוקים צמודים בלי הפסקה נענשים, והפסקה נספרת כנשמרה', () => {
    const st = state(inputOf([task('a'), task('b')]));
    const tight = evaluate(st.ctx, [piece('a', 0, 600, 60), piece('b', 0, 660, 60)]);
    const gap = evaluate(st.ctx, [piece('a', 0, 600, 60), piece('b', 0, 690, 60)]);
    expect(tight.raw.breaks).toBeGreaterThan(0);
    expect(tight.breaksKept).toBe(0);
    expect(gap.raw.breaks).toBe(0);
    expect(gap.breaksKept).toBe(1);
  });

  it('חלון מועדף של קטגוריה, מאמץ כבד מאוחר וחזרתיות באותו יום נענשים', () => {
    const cats = DEFAULT_CATEGORIES.map((c) => (c.id === 'study' ? { ...c, preferredWindow: { startMin: 540, endMin: 720 } } : c));
    const st = state(inputOf([task('s', { categoryId: 'study', effort: 'heavy' }), task('g', { timesPerWeek: 2 })], { categories: cats }));
    const good = evaluate(st.ctx, [piece('s', 0, 600, 60)]);
    const bad = evaluate(st.ctx, [piece('s', 0, 1100, 60)]);
    expect(good.raw.preferredWindow).toBe(0);
    expect(bad.raw.preferredWindow).toBeGreaterThan(0);
    expect(good.raw.effortOrder).toBe(0);
    expect(bad.raw.effortOrder).toBeGreaterThan(0);
    const sameDay = evaluate(st.ctx, [piece('g', 0, 600, 60, { occurrence: 0 }), piece('g', 0, 800, 60, { occurrence: 1, id: 'g2' })]);
    const diffDay = evaluate(st.ctx, [piece('g', 0, 600, 60, { occurrence: 0 }), piece('g', 1, 600, 60, { occurrence: 1, id: 'g2' })]);
    expect(sameDay.raw.repeatSpread).toBe(1);
    expect(diffDay.raw.repeatSpread).toBe(0);
  });

  it('השיפור המקומי לא מחמיר את העלות, ומשאיר הכול תקין', () => {
    const input = bigWeek(30);
    for (const p of PERSONALITIES) {
      const st = state(input, p);
      const rng = makeRng(3);
      greedyPlace(st, orderTasks(st.ctx, buildPlan(input, p).prep.schedulable, p), new Map(), rng);
      const before = evaluate(st.ctx, st.pieces).cost;
      const { passes, evaluations } = improve(st, rng);
      const after = evaluate(st.ctx, st.pieces).cost;
      expect(after).toBeLessThanOrEqual(before + 1e-9);
      expect(passes).toBeGreaterThanOrEqual(1);
      expect(evaluations).toBeLessThan(30_000);
    }
  });
});

describe('ביצועים', () => {
  it('שבוע גדול (60 משימות): שלוש וריאציות בתוך כמה שניות', () => {
    const input = bigWeek(60);
    const t0 = performance.now();
    const set = generateSchedules(input);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(5000);
    for (const s of set.schedules) expect(violations(input, s)).toEqual([]);
  }, 30_000);

  it('הרצה בעובד רקע: ההודעה והתשובה זהות להרצה ישירה', () => {
    const input = bigWeek(20);
    const res = handleRequest({ id: 7, input });
    expect(res).toEqual({ id: 7, ok: true, result: generateSchedules(input) });
  });
});
