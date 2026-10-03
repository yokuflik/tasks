import { describe, expect, it } from 'vitest';
import { loadScenarios } from '../fixtures';
import { generateSchedules, scheduleDistance, validateHardRules } from '../src/engine';

/** קריטריוני קבלה 2-5 מ-BUILD_PLAN סעיף 7, על כל תרחישי P0 עם המנוע האמיתי. */
const scenarios = Object.entries(loadScenarios());

describe.each(scenarios)('קבלה: %s', (_name, sc) => {
  const input = { week: sc.week, tasks: sc.tasks, categories: sc.categories, settings: sc.settings };
  const set = generateSchedules(input);

  it('שלושה סידורים', () => {
    expect(set.schedules).toHaveLength(3);
  });

  it('אין הפרות חוקים קשיחים בשום וריאציה', () => {
    for (const s of set.schedules) {
      const violations = validateHardRules({ week: sc.week, tasks: sc.tasks, categories: sc.categories, settings: sc.settings, blocks: s.blocks, exceptions: s.exceptions, requireAllAccounted: true });
      expect(violations).toEqual([]);
    }
  });

  it('כל לילה עם שינה של 8 שעות או שמדווח במפורש', () => {
    for (const s of set.schedules) {
      const reported = new Set(s.exceptions.sleepShortfalls.map((x) => x.date));
      for (const b of s.blocks.filter((x) => x.kind === 'sleep')) {
        if (!reported.has(b.range.date)) expect(b.range.endMin - b.range.startMin).toBeGreaterThanOrEqual(480);
      }
    }
  });

  it('משמרות קבועות לא זזות באף וריאציה', () => {
    for (const t of sc.tasks.filter((x) => x.flexibility === 'fixed' && x.constraints.fixedDate && x.constraints.fixedStartMin !== undefined)) {
      for (const s of set.schedules) {
        const bs = s.blocks.filter((b) => b.taskId === t.id);
        if (bs.length === 0) continue; // דווח כחריג
        expect(bs[0]!.range).toMatchObject({ date: t.constraints.fixedDate, startMin: t.constraints.fixedStartMin });
      }
    }
  });

  it('הוריאציות שונות זו מזו כשיש מספיק משימות גמישות בלי מגבלות', () => {
    // משימות עם מגבלות קשות (ימים אסורים, תלות מעגלית) משאירות מעט חופש, ולכן סופרים רק חופשיות
    const free = sc.tasks.filter((t) => t.flexibility !== 'fixed' && Object.keys(t.constraints).length === 0 && !t.dependsOn?.length);
    if (free.length < 3) return;
    let maxDistance = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      maxDistance = Math.max(maxDistance, scheduleDistance(set.schedules[i]!, set.schedules[j]!));
    }
    expect(maxDistance).toBeGreaterThan(0);
  });
});
