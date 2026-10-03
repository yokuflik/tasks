import { describe, expect, it } from 'vitest';
import { loadScenarios } from '../fixtures';
import { validateScenario } from '../fixtures/validate';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../src/contracts/defaults';
import { GRID_MINUTES, MAX_CATEGORIES } from '../src/contracts';
import type { Scenario } from '../src/contracts/scenario';

const scenarios = loadScenarios();
const REQUIRED = [
  'empty-week', 'overloaded-week', 'night-shifts', 'adjacent-shifts', 'task-larger-than-window',
  'circular-dependency', 'fixed-day-sequence', 'holiday-midweek', 'dst-transition', 'forbidden-days',
  'no-shifts-light', 'morning-shifts', 'shift-crossing-midnight',
];

describe('ברירות מחדל', () => {
  it('10 קטגוריות, עבודה היא הקבועה היחידה', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(MAX_CATEGORIES);
    expect(DEFAULT_CATEGORIES.filter((c) => c.fixed).map((c) => c.id)).toEqual(['work']);
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.id)).size).toBe(MAX_CATEGORIES);
  });
  it('חוק שינה 8/9 שעות ואין שעות שינה', () => {
    expect(DEFAULT_SETTINGS.minSleepMin).toBe(480);
    expect(DEFAULT_SETTINGS.targetSleepMin).toBe(540);
    expect(Object.keys(DEFAULT_SETTINGS).join()).not.toMatch(/sleepStart|sleepEnd|bedtime/i);
  });
  it('גודל משבצת 15', () => expect(GRID_MINUTES).toBe(15));
});

describe('תרחישים משותפים', () => {
  it.each(REQUIRED)('קיים תרחיש חובה: %s', (name) => expect(scenarios).toHaveProperty(name));
  it.each(Object.keys(scenarios))('%s תואם לחוזים', (name) => {
    expect(validateScenario(scenarios[name]!)).toEqual([]);
  });
  it('שמות קבצים תואמים לשם התרחיש', () => {
    for (const [file, sc] of Object.entries(scenarios)) expect(sc.name).toBe(file);
  });
  it('אין אף שעת שינה מובנית בתרחישים', () => {
    for (const sc of Object.values(scenarios)) expect(JSON.stringify(sc)).not.toMatch(/"kind":\s*"sleep"/);
  });
  it('תרחישי המשמרות: משמרות הן עבודה קבועה', () => {
    for (const name of ['morning-shifts', 'night-shifts', 'adjacent-shifts']) {
      const shifts = scenarios[name]!.tasks.filter((t) => t.categoryId === 'work');
      expect(shifts.length).toBeGreaterThan(0);
      shifts.forEach((t) => expect(t.flexibility).toBe('fixed'));
    }
  });
  it('לילה שחוצה חצות: משמרת לילה מסתיימת אחרי חצות', () => {
    const s = scenarios['night-shifts']!.tasks.find((t) => t.id === 's-0')!;
    expect(s.constraints.fixedStartMin! + s.durationMin).toBeGreaterThan(1440);
  });
  it('משמרות סמוכות משאירות פחות מ-8 שעות', () => {
    const t = scenarios['adjacent-shifts']!.tasks;
    const a = t.find((x) => x.id === 's-sun')!, b = t.find((x) => x.id === 's-mon')!;
    const gap = 1440 + b.constraints.fixedStartMin! - (a.constraints.fixedStartMin! + a.durationMin);
    expect(gap).toBeLessThan(480);
  });
  it('תרחיש חג: שבוע פסח עם ארבעה סימונים', () => {
    expect(scenarios['holiday-midweek']!.specialDays.map((s) => s.kind)).toEqual(['holiday_eve', 'holiday', 'chol_hamoed', 'shabbat']);
  });
  it('תלות מעגלית אכן מעגלית', () => {
    const t = Object.fromEntries(scenarios['circular-dependency']!.tasks.map((x) => [x.id, x.dependsOn]));
    expect(t['t-a']).toEqual(['t-c']); expect(t['t-c']).toEqual(['t-b']); expect(t['t-b']).toEqual(['t-a']);
  });
});

describe('הוולידטור עצמו דוחה תרחיש פגום', () => {
  const base = (): Scenario => structuredClone(scenarios['no-shifts-light']!);
  it('קטגוריה לא קיימת', () => {
    const s = base(); s.tasks[0]!.categoryId = 'nope';
    expect(validateScenario(s).length).toBeGreaterThan(0);
  });
  it('שבוע שלא מתחיל ביום ראשון', () => {
    const s = base(); s.week.startDate = '2026-06-08';
    expect(validateScenario(s)).toContain('השבוע חייב להתחיל ביום ראשון');
  });
  it('תלות בלתי קיימת', () => {
    const s = base(); s.tasks[0]!.dependsOn = ['ghost'];
    expect(validateScenario(s).length).toBeGreaterThan(0);
  });
  it('משימה קבועה בלי שעה', () => {
    const s = base(); s.tasks[0]!.flexibility = 'fixed';
    expect(validateScenario(s).length).toBeGreaterThan(0);
  });
});
