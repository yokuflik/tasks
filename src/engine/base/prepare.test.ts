import { describe, expect, it } from 'vitest';
import { loadScenario, loadScenarios } from '../../../fixtures';
import { findDependencyCycles } from './feasibility';
import { prepareWeek } from './prepare';
import { rangeToAbs } from './grid';
import { specialDaysInWeek } from '../../time';
import { DAYS, input, shift, task, week } from './testing/helpers';

describe('תרחישים משותפים מול הציפיות של חלק א', () => {
  for (const [name, s] of Object.entries(loadScenarios())) {
    it(name, () => {
      const p = prepareWeek(s);
      const ex = s.expect;
      // לילות חסרי שינה: בדיוק מה שהתרחיש קובע (ברירת מחדל: אין)
      expect(p.exceptions.sleepShortfalls.map((x) => x.date).sort()).toEqual([...(ex.sleepShortfallDates ?? [])].sort());
      // חריגים שהתרחיש מחייב: חייבים להופיע עם הסיבה (ועם המשימות הקשורות)
      for (const u of ex.unplaced ?? []) {
        const got = p.exceptions.unplaced.find((x) => x.taskId === u.taskId);
        expect(got?.reason, `${name}:${u.taskId}`).toBe(u.reason);
        if (u.relatedTaskIds) expect(got?.relatedTaskIds).toEqual(u.relatedTaskIds);
      }
      // משימות שחייבות להיות משובצות לא יכולות להיות בדוח, והקבועות כבר במקומן
      const fixedIds = new Set(p.fixedBlocks.map((b) => b.taskId));
      for (const id of ex.placedTaskIds ?? []) {
        expect(p.exceptions.unplaced.map((x) => x.taskId)).not.toContain(id);
        const t = s.tasks.find((x) => x.id === id)!;
        if (t.flexibility === 'fixed') expect(fixedIds.has(id)).toBe(true);
        else expect(p.schedulable.map((x) => x.id)).toContain(id);
      }
      // משמרות במקומן המדויק
      for (const b of p.fixedBlocks) {
        const t = s.tasks.find((x) => x.id === b.taskId)!;
        expect(b.range).toEqual({
          date: t.constraints.fixedDate,
          startMin: t.constraints.fixedStartMin,
          endMin: t.constraints.fixedStartMin! + t.durationMin,
        });
      }
    });
  }
});

describe('דוח חריגים', () => {
  it('תלות מעגלית: עוצר עם דוח, המשימה החופשית נשארת, ובלי להיתקע', () => {
    const p = prepareWeek(loadScenario('circular-dependency'));
    const r = Object.fromEntries(p.exceptions.unplaced.map((u) => [u.taskId, u.reason]));
    expect(r).toEqual({ 't-a': 'circular_dependency', 't-b': 'circular_dependency', 't-c': 'circular_dependency' });
    expect(p.schedulable.map((t) => t.id)).toEqual(['t-free']);
  });

  it('זיהוי מעגלים: לולאה עצמית, שני מעגלים נפרדים, ושרשרת בלי מעגל', () => {
    const self = task('s', { dependsOn: ['s'] });
    const a = task('a', { dependsOn: ['b'] });
    const b = task('b', { dependsOn: ['a'] });
    const x = task('x', { dependsOn: ['y'] });
    const y = task('y');
    expect(findDependencyCycles([self, a, b, x, y])).toEqual([['s'], ['a', 'b']]);
    expect(findDependencyCycles([x, y])).toEqual([]);
  });

  it('משימה שתלויה בכושלת נכשלת גם היא (dependency_unplaced), גם בשרשרת', () => {
    const p = prepareWeek(
      input([
        task('never', { constraints: { forbiddenWeekdays: [0, 1, 2, 3, 4, 5, 6] } }),
        task('child', { dependsOn: ['never'] }),
        task('grand', { dependsOn: ['child'] }),
        task('ok'),
      ]),
    );
    const byId = Object.fromEntries(p.exceptions.unplaced.map((u) => [u.taskId, u]));
    expect(byId['never']?.reason).toBe('forbidden_time');
    expect(byId['child']).toMatchObject({ reason: 'dependency_unplaced', relatedTaskIds: ['never'] });
    expect(byId['grand']).toMatchObject({ reason: 'dependency_unplaced', relatedTaskIds: ['child'] });
    expect(p.schedulable.map((t) => t.id)).toEqual(['ok']);
  });

  it('משימה גדולה מכל חלון: הסיבה larger_than_any_window; בפיצול היא נכנסת', () => {
    const s = loadScenario('task-larger-than-window');
    const p = prepareWeek(s);
    expect(p.exceptions.unplaced.map((u) => [u.taskId, u.reason])).toEqual([['t-big', 'larger_than_any_window']]);
    const split = { ...s, tasks: s.tasks.map((t) => (t.id === 't-big' ? { ...t, split: { splittable: true, minSegmentMin: 60 } } : t)) };
    expect(prepareWeek(split).exceptions.unplaced).toEqual([]);
  });

  it('ימים ושעות אסורים: כשל רק כשהמגבלות שוללות הכל', () => {
    const p = prepareWeek(loadScenario('forbidden-days'));
    expect(p.exceptions.unplaced.map((u) => [u.taskId, u.reason])).toEqual([['t-never', 'forbidden_time']]);
  });

  it('תאריך יעד לפני תחילת הזמן הפנוי: deadline_conflict', () => {
    const w = week({ dayWindows: { [DAYS[0]!]: { startMin: 600, endMin: 660 } }, activeDates: [DAYS[0]!, DAYS[1]!] });
    const p = prepareWeek(
      input(
        [
          task('late', { dueDate: DAYS[0]!, durationMin: 120 }), // יום ראשון: רק שעה פנויה
          task('before', { dueDate: '2026-06-01' }),
        ],
        w,
      ),
    );
    const r = Object.fromEntries(p.exceptions.unplaced.map((u) => [u.taskId, u.reason]));
    expect(r['late']).toBe('deadline_conflict'); // עד היעד רק חלון של שעה, ובשאר הימים יש מקום
    expect(r['before']).toBe('deadline_conflict');
  });

  it('אין זמן בגלל משמרות: not_enough_time; ובגלל שינה בלבד: would_break_sleep', () => {
    // יום יחיד פעיל, משמרת ממלאת את כל היום -> אין מקום
    const full = prepareWeek(input([shift('s', 0, 0, 1440), task('x')], week({ activeDates: [DAYS[0]!] })));
    expect(full.exceptions.unplaced.find((u) => u.taskId === 'x')?.reason).toBe('not_enough_time');
    // החלון היחיד (שעה לפני חצות) נמצא בתוך מקום השינה של אותו לילה
    const dayWindows = { [DAYS[0]!]: { startMin: 1380, endMin: 1440 } };
    const sleepy = prepareWeek(input([task('x', { durationMin: 60 })], week({ activeDates: [DAYS[0]!], dayWindows })));
    expect(sleepy.exceptions.unplaced.find((u) => u.taskId === 'x')?.reason).toBe('would_break_sleep');
  });

  it('משימה עם שעה קבועה שמתנגשת עם משמרת: fixed_conflict', () => {
    const p = prepareWeek(
      input([shift('s', 0, 540, 480), task('x', { durationMin: 60, constraints: { fixedDate: DAYS[0]!, fixedStartMin: 600 } })]),
    );
    expect(p.exceptions.unplaced.find((u) => u.taskId === 'x')?.reason).toBe('fixed_conflict');
  });

  it('משימות קבועות שחופפות זו לזו או לזמן חסום: הראשונה נשארת, האחרת בדוח; משמרת לא זזה', () => {
    const blocked = [{ id: 'b', title: 'x', source: 'ics' as const, range: { date: DAYS[2]!, startMin: 540, endMin: 600 } }];
    const p = prepareWeek(input([shift('s1', 2, 570, 120), shift('s2', 3, 600, 60), shift('s3', 3, 630, 60)], week({ blockedTimes: blocked })));
    expect(p.fixedBlocks.map((b) => b.taskId)).toEqual(['s2']);
    expect(p.exceptions.unplaced.map((u) => [u.taskId, u.reason]).sort()).toEqual([
      ['s1', 'fixed_conflict'],
      ['s3', 'fixed_conflict'],
    ]);
  });

  it('משמרת בלי יום/שעה או ביום לא פעיל: fixed_conflict ולא קריסה', () => {
    const p = prepareWeek(
      input(
        [
          task('nodate', { categoryId: 'work', flexibility: 'fixed' }),
          shift('off', 3, 600, 60),
        ],
        week({ activeDates: [DAYS[0]!, DAYS[1]!] }),
      ),
    );
    expect(p.exceptions.unplaced.map((u) => [u.taskId, u.reason])).toEqual([
      ['nodate', 'fixed_conflict'],
      ['off', 'fixed_conflict'],
    ]);
  });

  it('משימות שהושלמו מתעלמים מהן', () => {
    const p = prepareWeek(input([task('d', { status: 'done', dependsOn: ['d'] })]));
    expect(p.exceptions.unplaced).toEqual([]);
    expect(p.schedulable).toEqual([]);
  });

  it('שבת וחגים אינם משפיעים: תוצאה זהה עם, בלי ועם נתוני החגים האמיתיים של P2', () => {
    const s = loadScenario('holiday-midweek');
    expect(s.expect.specialDates!.length).toBeGreaterThan(0);
    const base = prepareWeek(s);
    const without = prepareWeek({ ...s, specialDays: [] } as typeof s);
    const real = specialDaysInWeek(s.week.startDate);
    expect(real.length).toBeGreaterThan(0);
    const withReal = prepareWeek({ ...s, specialDays: real } as typeof s);
    expect(without).toEqual(base);
    expect(withReal).toEqual(base);
    // המשימה שביום החג משובצת במקומה
    const hol = base.fixedBlocks.find((b) => b.taskId === 't-on-holiday')!;
    expect(hol.range.date).toBe('2027-04-22');
    expect(rangeToAbs(base.grid, hol.range).end - rangeToAbs(base.grid, hol.range).start).toBe(60);
  });

  it('שבוע עמוס מדי: חלק א לא קורס, אין דיווח שינה, כל המשימות עדיין ניתנות לשיבוץ בנפרד', () => {
    const p = prepareWeek(loadScenario('overloaded-week'));
    expect(p.exceptions.sleepShortfalls).toEqual([]);
    expect(p.schedulable).toHaveLength(14);
  });
});
