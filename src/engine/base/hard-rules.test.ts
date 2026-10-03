import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../../fixtures';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../../contracts/defaults';
import type { ExceptionsReport, ScheduleBlock } from '../../contracts';
import { validateHardRules } from './hard-rules';
import type { ViolationKind } from './hard-rules';
import { prepareWeek } from './prepare';
import { DAYS, shift, task, week } from './testing/helpers';
import type { Task, Week } from '../../contracts';

const empty: ExceptionsReport = { unplaced: [], sleepShortfalls: [] };
const blk = (id: string, taskId: string, day: number, startMin: number, endMin: number): ScheduleBlock => ({
  id,
  kind: 'task',
  taskId,
  range: { date: DAYS[day]!, startMin, endMin },
  locked: false,
});
const sleepBlk = (day: number, startMin: number, endMin: number): ScheduleBlock => ({
  id: `sl${day}`,
  kind: 'sleep',
  range: { date: DAYS[day]!, startMin, endMin },
  locked: false,
});

function kinds(tasks: Task[], blocks: ScheduleBlock[], over: { w?: Week; ex?: ExceptionsReport; all?: boolean } = {}): ViolationKind[] {
  const w = over.w ?? week({ activeDates: [DAYS[0]!, DAYS[1]!] });
  return validateHardRules({
    week: w,
    tasks,
    categories: DEFAULT_CATEGORIES,
    settings: DEFAULT_SETTINGS,
    blocks,
    exceptions: over.ex ?? { unplaced: [], sleepShortfalls: [{ date: DAYS[0]!, availableMin: 0, requiredMin: 480 }, { date: DAYS[1]!, availableMin: 0, requiredMin: 480 }] },
    requireAllAccounted: over.all ?? false,
  }).map((v) => v.kind);
}

describe('מאמת חוקים קשיחים', () => {
  it('סידור תקין לא מפיק הפרות', () => {
    const s = loadScenario('morning-shifts');
    const p = prepareWeek(s);
    expect(
      validateHardRules({ week: s.week, tasks: s.tasks, categories: s.categories, settings: s.settings, blocks: [...p.fixedBlocks, ...p.sleepBlocks], exceptions: p.exceptions }),
    ).toEqual([]);
  });

  it('חפיפה בין בלוקים, כולל בלוק שמוכל בתוך בלוק ארוך', () => {
    const ts = [task('a'), task('b'), task('c')];
    const k = kinds(ts, [blk('1', 'a', 0, 600, 900), blk('2', 'b', 0, 660, 720), blk('3', 'c', 0, 840, 900)]);
    expect(k.filter((x) => x === 'block_overlap')).toHaveLength(2);
  });

  it('חפיפה עם זמן חסום', () => {
    const w = week({ blockedTimes: [{ id: 'bt', title: 'x', source: 'manual', range: { date: DAYS[0]!, startMin: 600, endMin: 660 } }] });
    expect(kinds([task('a')], [blk('1', 'a', 0, 630, 690)], { w })).toContain('blocked_time_overlap');
    expect(kinds([task('a')], [blk('1', 'a', 0, 660, 720)], { w })).not.toContain('blocked_time_overlap');
  });

  it('משמרת שזזה, ומשמרת שנעלמה בלי דיווח', () => {
    const s = shift('s', 0, 540, 480);
    expect(kinds([s], [blk('1', 's', 0, 600, 1080)])).toContain('fixed_moved');
    expect(kinds([s], [blk('1', 's', 0, 540, 1020)])).not.toContain('fixed_moved');
    expect(kinds([s], [])).toContain('fixed_missing');
    expect(kinds([s], [], { ex: { unplaced: [{ taskId: 's', reason: 'fixed_conflict' }], sleepShortfalls: [] } })).not.toContain('fixed_missing');
  });

  it('שינה: חסרה בלי דיווח, קצרה בלי דיווח, כפולה', () => {
    const w = week({ activeDates: [DAYS[0]!] });
    const base = { w, ex: empty };
    expect(kinds([], [], base)).toContain('sleep_missing');
    expect(kinds([], [sleepBlk(0, 1380, 1380 + 300)], base)).toContain('sleep_missing');
    expect(kinds([], [sleepBlk(0, 1380, 1380 + 480)], base)).toEqual([]);
    expect(kinds([], [sleepBlk(0, 1320, 1320 + 240), sleepBlk(1, 60, 60 + 480)], base)).toContain('sleep_multiple');
    // דיווח מפורש מכשיר לילה קצר
    const ex = { unplaced: [], sleepShortfalls: [{ date: DAYS[0]!, availableMin: 300, requiredMin: 480 }] };
    expect(kinds([], [sleepBlk(0, 1380, 1380 + 300)], { w, ex })).toEqual([]);
  });

  it('משימה בתוך שינה נתפסת כחפיפה', () => {
    const w = week({ activeDates: [DAYS[0]!] });
    const k = kinds([task('a')], [sleepBlk(0, 1380, 1860), blk('1', 'a', 0, 1400, 1440)], { w, ex: empty });
    expect(k).toContain('block_overlap');
  });

  it('מגבלות: יום אסור, חלון אסור, תאריך יעד, יום קבוע, מחוץ לחלון פעילות', () => {
    const w = week({ dayWindows: { [DAYS[0]!]: { startMin: 480, endMin: 1080 } } });
    const mk = (c: Task['constraints'], over: Partial<Task> = {}) => task('a', { constraints: c, ...over });
    expect(kinds([mk({ forbiddenWeekdays: [0] })], [blk('1', 'a', 0, 600, 660)], { w })).toContain('forbidden_time');
    expect(kinds([mk({ forbiddenWindows: [{ startMin: 600, endMin: 630 }] })], [blk('1', 'a', 0, 615, 675)], { w })).toContain('forbidden_time');
    expect(kinds([mk({}, { dueDate: DAYS[0]! })], [blk('1', 'a', 1, 600, 660)], { w })).toContain('deadline');
    expect(kinds([mk({ fixedDate: DAYS[1]! })], [blk('1', 'a', 0, 600, 660)], { w })).toContain('fixed_time');
    expect(kinds([mk({ fixedDate: DAYS[0]!, fixedStartMin: 600 })], [blk('1', 'a', 0, 660, 720)], { w })).toContain('fixed_time');
    expect(kinds([mk({})], [blk('1', 'a', 0, 1080, 1140)], { w })).toContain('outside_window');
    expect(kinds([mk({})], [blk('1', 'a', 0, 600, 660)], { w })).toEqual(expect.not.arrayContaining(['forbidden_time', 'deadline', 'fixed_time', 'outside_window']));
  });

  it('תלויות: סדר שגוי, ותלות שלא שובצה', () => {
    const ts = [task('a'), task('b', { dependsOn: ['a'] })];
    expect(kinds(ts, [blk('1', 'a', 0, 700, 760), blk('2', 'b', 0, 600, 660)])).toContain('dependency_order');
    expect(kinds(ts, [blk('1', 'a', 0, 600, 660), blk('2', 'b', 0, 660, 720)])).not.toContain('dependency_order');
    expect(
      kinds(ts, [blk('2', 'b', 0, 660, 720)], { ex: { unplaced: [{ taskId: 'a', reason: 'not_enough_time' }], sleepShortfalls: [] } }),
    ).toContain('dependency_unplaced');
  });

  it('בלוק לא מיושר, בלוק של משימה לא קיימת, ומשימה שנעלמה', () => {
    expect(kinds([task('a')], [blk('1', 'a', 0, 605, 660)])).toContain('misaligned');
    expect(kinds([task('a')], [blk('1', 'zzz', 0, 600, 660)])).toContain('unknown_task');
    expect(kinds([task('a')], [], { all: true })).toContain('task_unaccounted');
    expect(kinds([task('a')], [], { all: false })).not.toContain('task_unaccounted');
    expect(kinds([task('a')], [], { all: true, ex: { unplaced: [{ taskId: 'a', reason: 'not_enough_time' }], sleepShortfalls: [] } })).not.toContain('task_unaccounted');
  });
});
