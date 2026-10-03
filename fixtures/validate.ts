import type { Scenario } from '../src/contracts/scenario';

const PRIORITIES = ['low', 'medium', 'high'];
const FLEX = ['fixed', 'semi', 'flexible'];
const EFFORT = ['heavy', 'medium', 'light'];
const STATUS = ['pending', 'scheduled', 'done', 'postponed'];
const SPECIAL = ['shabbat', 'holiday', 'holiday_eve', 'chol_hamoed'];
const REASONS = [
  'not_enough_time', 'deadline_conflict', 'larger_than_any_window', 'forbidden_time',
  'fixed_conflict', 'circular_dependency', 'dependency_unplaced', 'would_break_sleep',
];

const isoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const weekday = (s: string) => new Date(s + 'T12:00:00Z').getUTCDay();
const minutes = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 2880;

/** בדיקת תקינות של תרחיש מול החוזים. מחזיר רשימת שגיאות, ריקה אם תקין. */
export function validateScenario(sc: Scenario): string[] {
  const errs: string[] = [];
  const e = (m: string) => errs.push(m);
  const range = (where: string, r: { date: string; startMin: number; endMin: number }) => {
    if (!isoDate(r.date)) e(`${where}: תאריך לא תקין`);
    if (!minutes(r.startMin) || !minutes(r.endMin) || r.endMin <= r.startMin) e(`${where}: טווח זמן לא תקין`);
  };

  if (sc.categories.length === 0 || sc.categories.length > 10) e('מספר קטגוריות מחוץ ל-1..10');
  const catIds = new Set(sc.categories.map((c) => c.id));
  if (catIds.size !== sc.categories.length) e('מזהי קטגוריה כפולים');

  if (sc.settings.minSleepMin !== 480 || sc.settings.targetSleepMin !== 540) e('חוק שינה: 8 שעות מינימום ו-9 יעד');
  if ('sleepStart' in sc.settings || 'sleepEnd' in sc.settings) e('אסור שיהיו שעות שינה ברירת מחדל');

  const w = sc.week;
  if (!isoDate(w.startDate) || weekday(w.startDate) !== 0) e('השבוע חייב להתחיל ביום ראשון');
  w.activeDates.forEach((d) => { if (!isoDate(d)) e(`תאריך פעיל לא תקין ${d}`); });
  for (const [d, win] of Object.entries(w.dayWindows ?? {})) {
    if (!w.activeDates.includes(d)) e(`חלון ליום לא פעיל ${d}`);
    if (!minutes(win.startMin) || !minutes(win.endMin) || win.endMin <= win.startMin) e(`חלון יום לא תקין ${d}`);
  }
  w.blockedTimes.forEach((b) => range(`זמן חסום ${b.id}`, b.range));

  const taskIds = new Set(sc.tasks.map((t) => t.id));
  if (taskIds.size !== sc.tasks.length) e('מזהי משימה כפולים');
  if (JSON.stringify([...w.taskIds].sort()) !== JSON.stringify([...taskIds].sort())) e('week.taskIds לא תואם למשימות');

  for (const t of sc.tasks) {
    const p = `משימה ${t.id}`;
    if (!catIds.has(t.categoryId)) e(`${p}: קטגוריה לא קיימת`);
    if (!minutes(t.durationMin) || t.durationMin === 0) e(`${p}: משך לא תקין`);
    if (!PRIORITIES.includes(t.priority)) e(`${p}: עדיפות לא תקינה`);
    if (!FLEX.includes(t.flexibility)) e(`${p}: גמישות לא תקינה`);
    if (!EFFORT.includes(t.effort)) e(`${p}: מאמץ לא תקין`);
    if (!STATUS.includes(t.status)) e(`${p}: סטטוס לא תקין`);
    if (!Number.isInteger(t.timesPerWeek) || t.timesPerWeek < 1) e(`${p}: חזרתיות לא תקינה`);
    if (t.dueDate !== undefined && !isoDate(t.dueDate)) e(`${p}: תאריך יעד לא תקין`);
    t.dependsOn.forEach((d) => { if (!taskIds.has(d)) e(`${p}: תלות במשימה לא קיימת ${d}`); });
    const c = t.constraints;
    if (c.fixedDate !== undefined && !w.activeDates.includes(c.fixedDate)) e(`${p}: יום קבוע מחוץ לשבוע`);
    if (c.fixedStartMin !== undefined && (!minutes(c.fixedStartMin) || c.fixedDate === undefined)) e(`${p}: שעה קבועה בלי יום`);
    if (t.flexibility === 'fixed' && (c.fixedDate === undefined || c.fixedStartMin === undefined)) e(`${p}: משימה קבועה חייבת יום ושעה`);
    const cat = sc.categories.find((x) => x.id === t.categoryId);
    if (cat?.fixed && t.flexibility !== 'fixed') e(`${p}: קטגוריה קבועה דורשת גמישות fixed`);
    if (t.split.splittable && t.split.minSegmentMin !== undefined && t.split.minSegmentMin > t.durationMin) e(`${p}: מקטע גדול ממשך`);
  }

  sc.specialDays.forEach((s) => {
    if (!isoDate(s.date) || !SPECIAL.includes(s.kind) || !s.name || !s.hebrewDate) e(`יום מיוחד לא תקין ${s.date}`);
    if (s.kind === 'shabbat' && isoDate(s.date) && weekday(s.date) !== 6) e(`שבת שאינה ביום שבת ${s.date}`);
  });

  sc.expect.unplaced?.forEach((u) => {
    if (!taskIds.has(u.taskId)) e(`expect: משימה לא קיימת ${u.taskId}`);
    if (!REASONS.includes(u.reason)) e(`expect: סיבה לא מוכרת ${u.reason}`);
  });
  sc.expect.placedTaskIds?.forEach((id) => { if (!taskIds.has(id)) e(`expect: משימה לא קיימת ${id}`); });
  return errs;
}
