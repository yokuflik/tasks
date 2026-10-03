import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../fixtures';
import type { Schedule, ScheduleBlock, Task } from '../contracts';
import { generateSchedules } from '../engine';
import {
  categoryTotals, classifyPress, copyTasksToNextWeek, createShift, createTask, createWeek, dayAvailableMin,
  dayLoadMin, differingBlockIds, dropTarget, endAfter, isBlockMovable, isDoneSwipe, lockedBlocksOf, moveBlock,
  parseTimeInput, scheduleSummary, segmentsForDate, setBlockLocked, sleepMinForNight, snap, timeInputValue,
  validateTaskForm, type EditContext, type TaskForm,
} from './model';

function setup(name = 'morning-shifts') {
  const sc = loadScenario(name);
  const tasks = sc.tasks;
  const set = generateSchedules({ week: sc.week, tasks, categories: sc.categories, settings: sc.settings });
  const ctx: EditContext = { week: sc.week, tasks, categories: sc.categories, settings: sc.settings };
  return { sc, tasks, set, ctx };
}

describe('זמן', () => {
  it('מפרש שעות ודוחה קלט שגוי', () => {
    expect(parseTimeInput('07:30')).toBe(450);
    expect(parseTimeInput('7:05')).toBe(425);
    expect(parseTimeInput('24:00')).toBeUndefined();
    expect(parseTimeInput('12:60')).toBeUndefined();
    expect(parseTimeInput('')).toBeUndefined();
    expect(timeInputValue(450)).toBe('07:30');
    expect(timeInputValue(1500)).toBe('01:00');
  });
  it('סיום שקטן מההתחלה חוצה חצות', () => {
    expect(endAfter(420, 900)).toBe(900);
    expect(endAfter(1320, 360)).toBe(1800);
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
  });
});

describe('בניית משמרות ומשימות', () => {
  it('משמרת היא משימת עבודה קבועה עם יום ושעה', () => {
    const s = createShift('w1', { date: '2026-06-07', startMin: 420, endMin: 900 }, 's1');
    expect(s).toMatchObject({ categoryId: 'work', flexibility: 'fixed', durationMin: 480, weekId: 'w1' });
    expect(s.constraints).toEqual({ fixedDate: '2026-06-07', fixedStartMin: 420 });
  });
  it('משמרת לילה חוצה חצות', () => {
    const s = createShift('w1', { date: '2026-06-07', startMin: 1320, endMin: 390 }, 's1');
    expect(s.durationMin).toBe(510);
  });
  it('בניית שבוע: ראשון עד שבת', () => {
    const w = createWeek('2026-06-07');
    expect(w.activeDates).toHaveLength(7);
    expect(w.activeDates[0]).toBe('2026-06-07');
    expect(w.activeDates[6]).toBe('2026-06-13');
  });
});

describe('טופס משימה', () => {
  const base: TaskForm = {
    title: ' קריאה ', categoryId: 'study', durationMin: 60, travelMin: 0,
    flexibility: 'flexible', timesPerWeek: 2.7, splittable: true, minSegmentMin: 30, dependsOn: [],
  };
  it('בונה משימה תקינה בלי שדות ריקים', () => {
    const t = createTask('w1', base, 't1');
    expect(t.title).toBe('קריאה');
    expect(t.timesPerWeek).toBe(2);
    expect(t.split).toEqual({ splittable: true, minSegmentMin: 30 });
    expect(t.status).toBe('pending');
    expect('dueDate' in t).toBe(false);
    expect(t.constraints).toEqual({});
    expect(t.priority).toBe('medium');
    expect('travelMin' in t).toBe(false);
  });
  it('עדיפות עליונה רק לבריאות, ונסיעה נשמרת', () => {
    const t = createTask('w1', { ...base, categoryId: 'health', travelMin: 20 }, 't2');
    expect(t.priority).toBe('high');
    expect(t.travelMin).toBe(20);
  });
  it('מאמת כותרת, משך ושעה קבועה בלי יום', () => {
    expect(validateTaskForm(base)).toEqual({});
    expect(validateTaskForm({ ...base, title: '  ' }).title).toBeDefined();
    expect(validateTaskForm({ ...base, durationMin: 10 }).duration).toBeDefined();
    expect(validateTaskForm({ ...base, durationMin: 50 }).duration).toBeDefined();
    expect(validateTaskForm({ ...base, fixedStartMin: 600 }).fixed).toBeDefined();
    expect(validateTaskForm({ ...base, fixedStartMin: 600, fixedDate: '2026-06-08' })).toEqual({});
  });
  it('העתקה משבוע קודם: בלי משמרות, תאריכים מוזזים, תלויות מעודכנות', () => {
    const shift = createShift('w1', { date: '2026-06-07', startMin: 420, endMin: 900 }, 's1');
    const a = createTask('w1', { ...base, fixedDate: '2026-06-08', dueDate: '2026-06-10' }, 'a');
    const b = createTask('w1', { ...base, dependsOn: ['a', 'gone'] }, 'b');
    const copies = copyTasksToNextWeek([shift, a, b], 'w2', 7);
    expect(copies).toHaveLength(2);
    const [ca, cb] = copies as [Task, Task];
    expect(ca.id).not.toBe('a');
    expect(ca.weekId).toBe('w2');
    expect(ca.constraints.fixedDate).toBe('2026-06-15');
    expect(ca.dueDate).toBe('2026-06-17');
    expect(cb.dependsOn).toEqual([ca.id]);
    expect(copies.every((c) => c.status === 'pending')).toBe(true);
  });
});

describe('בלוקים לפי יום', () => {
  const night: ScheduleBlock = { id: 'sl', kind: 'sleep', range: { date: '2026-06-07', startMin: 1380, endMin: 1980 }, locked: false };
  it('שינה שחוצה חצות מופיעה בשני הימים', () => {
    const d1 = segmentsForDate([night], '2026-06-07');
    const d2 = segmentsForDate([night], '2026-06-08');
    expect(d1[0]).toMatchObject({ startMin: 1380, endMin: 1440, continuation: false });
    expect(d2[0]).toMatchObject({ startMin: 0, endMin: 540, continuation: true });
    expect(segmentsForDate([night], '2026-06-09')).toEqual([]);
    expect(sleepMinForNight([night], '2026-06-07')).toBe(600);
  });
  it('עומס זמין ושינה', () => {
    const t: ScheduleBlock = { id: 't', kind: 'task', taskId: 'x', range: { date: '2026-06-07', startMin: 600, endMin: 660 }, locked: false };
    expect(dayLoadMin([night, t], '2026-06-07')).toBe(60);
    expect(dayAvailableMin({}, [night], '2026-06-07')).toBe(1440 - 60);
    expect(dayAvailableMin({ dayWindows: { '2026-06-07': { startMin: 480, endMin: 1320 } } }, [night], '2026-06-07')).toBe(840);
  });
});

describe('עריכה ידנית על סידור אמיתי', () => {
  it('משמרות ושינה לא זזות, משימה גמישה זזה למקום פנוי ונדחית על התנגשות', () => {
    const { sc, set, ctx } = setup();
    const sched = set.schedules[0] as Schedule;
    const shiftBlock = sched.blocks.find((b) => b.kind === 'task' && b.taskId === 's-0') as ScheduleBlock;
    const sleep = sched.blocks.find((b) => b.kind === 'sleep') as ScheduleBlock;
    const flexible = sched.blocks.find((b) => b.kind === 'task' && b.taskId === 't-gym') as ScheduleBlock;

    expect(isBlockMovable(shiftBlock, ctx)).toBe(false);
    expect(isBlockMovable(flexible, ctx)).toBe(true);
    const r1 = moveBlock(sched, shiftBlock.id, '2026-06-08', 600, ctx);
    expect(r1.ok).toBe(false);
    expect(moveBlock(sched, sleep.id, '2026-06-08', 600, ctx).ok).toBe(false);

    // התנגשות עם משמרת
    const clash = moveBlock(sched, flexible.id, shiftBlock.range.date, shiftBlock.range.startMin + 60, ctx);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.reason.length).toBeGreaterThan(0);

    // שבת פנויה: מותר (שבת היא סימון בלבד)
    const free = moveBlock(sched, flexible.id, sc.week.activeDates[6] as string, 11 * 60 + 7, ctx);
    expect(free.ok).toBe(true);
    if (free.ok) {
      const moved = free.schedule.blocks.find((b) => b.id === flexible.id) as ScheduleBlock;
      expect(moved.range.startMin).toBe(11 * 60);
      expect(moved.range.endMin - moved.range.startMin).toBe(flexible.range.endMin - flexible.range.startMin);
    }
    // המקור לא השתנה
    expect(sched.blocks.find((b) => b.id === flexible.id)).toBe(flexible);
  });

  it('בלוק נעול לא זז, ונעילה משתקפת בשיבוץ מחדש', () => {
    const { set, ctx } = setup();
    const sched = set.schedules[1] as Schedule;
    const flexible = sched.blocks.find((b) => b.kind === 'task' && b.taskId === 't-study') as ScheduleBlock;
    const locked = setBlockLocked(sched, flexible.id, true);
    expect(moveBlock(locked, flexible.id, '2026-06-09', 900, ctx).ok).toBe(false);
    expect(lockedBlocksOf(locked).map((b) => b.id)).toEqual([flexible.id]);
    expect(lockedBlocksOf(undefined)).toEqual([]);
    expect(lockedBlocksOf(setBlockLocked(locked, flexible.id, false))).toEqual([]);
  });

  it('שיבוץ מחדש מכבד בלוק נעול', () => {
    const { sc, tasks, set } = setup();
    const sched = set.schedules[0] as Schedule;
    const target = sched.blocks.find((b) => b.kind === 'task' && b.taskId === 't-gym') as ScheduleBlock;
    const locked = setBlockLocked(sched, target.id, true);
    const again = generateSchedules({ week: sc.week, tasks, categories: sc.categories, settings: sc.settings, lockedBlocks: lockedBlocksOf(locked), seed: 9 });
    for (const s of again.schedules) {
      const same = s.blocks.find((b) => b.id === target.id);
      expect(same?.range).toEqual(target.range);
    }
  });

  it('מדיניות: אחרי הזזה חוקית אין הפרות חדשות', () => {
    const { set, ctx } = setup('no-shifts-light');
    const sched = set.schedules[2] as Schedule;
    const movable = sched.blocks.filter((b) => isBlockMovable(b, ctx));
    expect(movable.length).toBeGreaterThan(0);
    let current = sched;
    let accepted = 0;
    for (const b of movable.slice(0, 6)) {
      for (const date of ctx.week.activeDates) {
        const r = moveBlock(current, b.id, date, 12 * 60, ctx);
        if (r.ok) { current = r.schedule; accepted++; break; }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    const ids = new Set(current.blocks.map((b) => b.id));
    expect(ids.size).toBe(current.blocks.length);
  });
});

describe('השוואה וסיכום', () => {
  it('מזהה בלוקים שממוקמים אחרת בין הוריאציות', () => {
    const { set } = setup('no-shifts-light');
    const [a, b, c] = set.schedules as [Schedule, Schedule, Schedule];
    const da = differingBlockIds(set.schedules, 0);
    expect(da.size).toBeGreaterThan(0);
    for (const id of da) expect(a.blocks.some((x) => x.id === id && x.kind === 'task')).toBe(true);
    // סידור מול עצמו: אין הבדלים
    expect(differingBlockIds([a, a], 0).size).toBe(0);
    expect(differingBlockIds(set.schedules, 7).size).toBe(0);
    expect(differingBlockIds([b, c], 1).size).toBeGreaterThan(0);
  });
  it('סיכום ופילוח קטגוריות', () => {
    const { sc, set } = setup();
    for (const s of set.schedules) expect(scheduleSummary(s).length).toBeGreaterThan(0);
    const totals = categoryTotals((set.schedules[0] as Schedule).blocks, sc.tasks, sc.categories);
    expect(totals.find((t) => t.category.id === 'work')?.minutes).toBe(5 * 480);
    expect(totals.every((t) => t.minutes > 0)).toBe(true);
  });
});

describe('מגע וגרירה', () => {
  const cols = [
    { date: '2026-06-07', left: 0, right: 100 },
    { date: '2026-06-08', left: 100, right: 200 },
  ];
  it('מתרגם נקודה ליום ולשעה צמודה לרבע שעה', () => {
    expect(dropTarget(150, 300 + 60, cols, 60 + 0, 0.5, 0)).toEqual({ date: '2026-06-08', startMin: 600 });
    expect(dropTarget(10, 60 + 125 * 0.5, cols, 60, 0.5, 0)).toEqual({ date: '2026-06-07', startMin: 120 });
  });
  it('כולל היסט אחיזה, גבולות ויום לא קיים', () => {
    expect(dropTarget(10, 60 + 200 * 0.5, cols, 60, 0.5, 30)).toEqual({ date: '2026-06-07', startMin: 165 });
    expect(dropTarget(10, -500, cols, 60, 0.5, 0)?.startMin).toBe(0);
    expect(dropTarget(10, 99999, cols, 60, 0.5, 0)?.startMin).toBe(1425);
    expect(dropTarget(500, 100, cols, 60, 0.5, 0)).toBeUndefined();
  });
  it('מבדיל נגיעה, לחיצה ארוכה וגרירה', () => {
    expect(classifyPress(2, 100)).toBe('tap');
    expect(classifyPress(2, 600)).toBe('long-press');
    expect(classifyPress(30, 600)).toBe('drag');
  });
  it('החלקה אופקית ברורה מסמנת בוצע', () => {
    expect(isDoneSwipe(-120, 10)).toBe(true);
    expect(isDoneSwipe(120, 10)).toBe(true);
    expect(isDoneSwipe(40, 0)).toBe(false);
    expect(isDoneSwipe(100, 90)).toBe(false);
  });
});
