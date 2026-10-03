import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../contracts/defaults';
import type { Schedule, Task, Week } from '../contracts/index';
import { loadScenarios } from '../../fixtures/index';
import {
  BackupError, StorageError, backupFileName, backupReminder, openStorage, parseBackup, requestPersistence,
  validateData,
  type Storage,
} from './index';

let n = 0;
let store: Storage;
let dbName: string;
const opened: Storage[] = [];

async function open(extra: Parameters<typeof openStorage>[0] = {}): Promise<Storage> {
  const s = await openStorage({ name: dbName, ...extra });
  opened.push(s);
  return s;
}

beforeEach(async () => {
  dbName = `test-db-${++n}`;
  store = await open({ now: () => new Date('2026-10-03T10:00:00.000Z') });
});
afterEach(() => {
  while (opened.length) opened.pop()?.close();
});

const sample = loadScenarios()['overloaded-week']!;

/** טוען תרחיש מלא (כולל סידור) לאחסון. */
async function load(): Promise<{ tasks: Task[]; week: Week }> {
  const sched: Schedule = {
    id: 's1', personality: 'balanced', seed: 7,
    score: { total: 1, placedCount: 1, totalCount: 1, breaksKept: 0, maxDayLoadMin: 60, penalties: { a: 1 } },
    blocks: [
      { id: 'b1', kind: 'task', taskId: sample.tasks[0]!.id, range: { date: sample.week.startDate, startMin: 600, endMin: 660 }, locked: true },
      { id: 'b2', kind: 'sleep', range: { date: sample.week.startDate, startMin: 1380, endMin: 1920 }, locked: false },
    ],
    exceptions: { unplaced: [{ taskId: 'x', reason: 'not_enough_time', suggestion: 'פנה זמן' }], sleepShortfalls: [] },
  };
  const week: Week = { ...sample.week, schedules: [sched], selectedScheduleId: 's1' };
  const tasks = sample.tasks.map((t) => ({ ...t, weekId: week.id }));
  await store.saveSettings({ ...sample.settings });
  for (const c of sample.categories) await store.saveCategory(c);
  await store.saveTasks(tasks);
  await store.saveWeek(week);
  return { tasks, week };
}

describe('שמירה ושליפה לכל ישות', () => {
  it('פתיחה ראשונה מזרעת הגדרות וקטגוריות ברירת מחדל', async () => {
    expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect((await store.listCategories()).map((c) => c.id).sort()).toEqual(DEFAULT_CATEGORIES.map((c) => c.id).sort());
    expect(await store.listTasks()).toEqual([]);
    expect(await store.listWeeks()).toEqual([]);
  });

  it('הגדרות', async () => {
    const s = { ...DEFAULT_SETTINGS, minBreakMin: 30, maxConsecutiveMin: 120, warnOnSpecialDays: true };
    await store.saveSettings(s);
    expect(await store.getSettings()).toEqual(s);
  });

  it('קטגוריה: שמירה, עדכון ומחיקה', async () => {
    const c = { id: 'x', name: 'חדשה', color: '#fff', icon: 'star', fixed: false, canCombine: true, preferredWindow: { startMin: 480, endMin: 600 }, dailyCapMin: 90 };
    await store.saveCategory(c);
    expect((await store.listCategories()).find((k) => k.id === 'x')).toEqual(c);
    await store.saveCategory({ ...c, name: 'שם אחר' });
    expect((await store.listCategories()).find((k) => k.id === 'x')?.name).toBe('שם אחר');
    await store.deleteCategory('x');
    expect((await store.listCategories()).some((k) => k.id === 'x')).toBe(false);
  });

  it('מחיקת קטגוריה בשימוש נדחית ולא משנה כלום', async () => {
    const { tasks } = await load();
    const used = tasks[0]!.categoryId;
    await expect(store.deleteCategory(used)).rejects.toBeInstanceOf(StorageError);
    expect((await store.listCategories()).some((c) => c.id === used)).toBe(true);
  });

  it('משימות: כל הסוגים נשמרים ונשלפים זהים', async () => {
    const { tasks } = await load();
    expect(await store.listTasks()).toEqual([...tasks].sort((a, b) => (a.id < b.id ? -1 : 1)));
    for (const t of tasks) expect(await store.getTask(t.id)).toEqual(t);
    expect(await store.getTask('nope')).toBeUndefined();
  });

  it('משימות לפי שבוע', async () => {
    const { tasks } = await load();
    await store.saveTask({ ...tasks[0]!, id: 'other', weekId: 'other-week' });
    expect((await store.listTasksByWeek('other-week')).map((t) => t.id)).toEqual(['other']);
    expect(await store.listTasksByWeek(sample.week.id)).toHaveLength(tasks.length);
  });

  it('שבוע עם סידורים, זמנים חסומים וחלונות יום', async () => {
    const { week } = await load();
    expect(await store.getWeek(week.id)).toEqual(week);
    expect(await store.getWeekByStartDate(week.startDate)).toEqual(week);
    expect(await store.listWeeks()).toEqual([week]);
  });

  it('מחיקת משימה מנקה הפניות בשבוע, בתלויות ובבלוקים', async () => {
    const { tasks, week } = await load();
    const [a, b] = tasks;
    await store.saveTask({ ...b!, dependsOn: [a!.id] });
    await store.deleteTask(a!.id);
    expect(await store.getTask(a!.id)).toBeUndefined();
    expect((await store.getTask(b!.id))?.dependsOn).toEqual([]);
    const w = (await store.getWeek(week.id))!;
    expect(w.taskIds).not.toContain(a!.id);
    expect(w.schedules[0]!.blocks.some((x) => x.taskId === a!.id)).toBe(false);
    // המצב אחרי מחיקה עדיין ניתן לגיבוי וייבוא
    const { text } = await store.exportBackup();
    expect(() => parseBackup(text)).not.toThrow();
  });

  it('מחיקת שבוע משחררת את המשימות שלו אך לא מוחקת אותן', async () => {
    const { tasks, week } = await load();
    await store.deleteWeek(week.id);
    expect(await store.getWeek(week.id)).toBeUndefined();
    const left = await store.listTasks();
    expect(left).toHaveLength(tasks.length);
    expect(left.every((t) => t.weekId === undefined)).toBe(true);
  });

  it('הנתונים שורדים סגירה ופתיחה מחדש', async () => {
    const { week } = await load();
    store.close();
    const again = await open();
    expect(await again.getWeek(week.id)).toEqual(week);
  });
});

describe('מיגרציית גרסאות סכמה', () => {
  it('מסד בגרסה ישנה עובר מיגרציה בפתיחה, והנתונים נשמרים', async () => {
    store.close();
    const old = 'legacy-db';
    const legacy = await openDB(old, 1, {
      upgrade(db) {
        db.createObjectStore('settings');
        db.createObjectStore('categories', { keyPath: 'id' });
        const t = db.createObjectStore('tasks', { keyPath: 'id' });
        t.createIndex('weekId', 'weekId');
        const w = db.createObjectStore('weeks', { keyPath: 'id' });
        w.createIndex('startDate', 'startDate');
      },
    });
    await legacy.put('settings', DEFAULT_SETTINGS, 'main');
    await legacy.put('categories', DEFAULT_CATEGORIES.find((c) => c.id === 'work')!);
    await legacy.put('tasks', { id: 'old-task', title: 'ישנה' });
    legacy.close();

    const ran: number[] = [];
    const s = await openStorage({
      name: old,
      version: 3,
      migrations: {
        2: async (_db, tx) => {
          ran.push(2);
          const tasks = tx.objectStore('tasks');
          for (const t of await tasks.getAll()) await tasks.put({ ...t, timesPerWeek: 1 });
        },
        3: () => {
          ran.push(3);
        },
      },
    });
    opened.push(s);
    expect(ran).toEqual([2, 3]);
    expect(await s.getTask('old-task')).toMatchObject({ title: 'ישנה', timesPerWeek: 1 });
    expect((await s.listCategories()).map((c) => c.id)).toContain('work');
  });

  it('מיגרציה חסרה נכשלת בפתיחה', async () => {
    store.close();
    await expect(openStorage({ name: dbName, version: 2, migrations: {} })).rejects.toBeDefined();
    // השדרוג בוטל: המסד נשאר שמיש בגרסה 1 עם הנתונים
    const again = await open();
    expect(await again.listCategories()).not.toHaveLength(0);
  });

  it('גיבוי מגרסה ישנה עובר מיגרציית נתונים בייבוא', async () => {
    await load();
    const { file } = await store.exportBackup();
    const old = JSON.stringify({
      ...file,
      schemaVersion: 1,
      data: { ...file.data, tasks: file.data.tasks.map((t) => { const r: Partial<Task> = { ...t }; delete r.timesPerWeek; return r; }) },
    });
    const data = parseBackup(old, {
      currentVersion: 2,
      migrations: { 2: (d) => ({ ...d, tasks: (d['tasks'] as object[]).map((t) => ({ ...t, timesPerWeek: 1 })) }) },
    });
    expect(data.settings.schemaVersion).toBe(2);
    expect(data.tasks.every((t) => t.timesPerWeek === 1)).toBe(true);
  });

  it('גיבוי מגרסה חדשה מהאפליקציה נדחה', async () => {
    const { file } = await store.exportBackup();
    expect(() => parseBackup(JSON.stringify({ ...file, schemaVersion: 99 }))).toThrow(BackupError);
  });
});

describe('ייצוא וייבוא גיבוי', () => {
  it('ייצוא ואז ייבוא למסד ריק נותן נתונים זהים', async () => {
    await load();
    const { text } = await store.exportBackup();
    const expected = {
      settings: await store.getSettings(),
      categories: await store.listCategories(),
      tasks: await store.listTasks(),
      weeks: await store.listWeeks(),
    };
    dbName = `test-db-${++n}`;
    const fresh = await open();
    await fresh.importBackup(text);
    expect({
      settings: await fresh.getSettings(),
      categories: await fresh.listCategories(),
      tasks: await fresh.listTasks(),
      weeks: await fresh.listWeeks(),
    }).toEqual(expected);
  });

  it('ייבוא מחליף את הנתונים הקיימים במלואם', async () => {
    await load();
    const { text } = await store.exportBackup();
    await store.saveTask({ ...sample.tasks[0]!, id: 'extra' });
    await store.saveCategory({ id: 'extra-cat', name: 'x', color: '#000', icon: 'x', fixed: false, canCombine: true });
    await store.importBackup(text);
    expect(await store.getTask('extra')).toBeUndefined();
    expect((await store.listCategories()).some((c) => c.id === 'extra-cat')).toBe(false);
  });

  it('ייצוא מעדכן את lastBackupAt וכולל אותו בקובץ', async () => {
    expect((await store.getSettings()).lastBackupAt).toBeUndefined();
    const { file } = await store.exportBackup();
    expect(file.data.settings.lastBackupAt).toBe('2026-10-03T10:00:00.000Z');
    expect((await store.getSettings()).lastBackupAt).toBe('2026-10-03T10:00:00.000Z');
  });

  it('שם קובץ מוצע', () => {
    expect(backupFileName(new Date('2026-10-03T10:00:00Z'))).toBe('task-planner-backup-2026-10-03.json');
  });

  it('תרחישי הבדיקה המשותפים כולם עוברים ייצוא וייבוא זהים', async () => {
    for (const [name, sc] of Object.entries(loadScenarios())) {
      dbName = `scenario-${name}-${++n}`;
      const s = await open();
      await s.saveSettings(sc.settings);
      for (const c of sc.categories) await s.saveCategory(c);
      for (const c of DEFAULT_CATEGORIES) if (!sc.categories.some((k) => k.id === c.id)) await s.deleteCategory(c.id);
      await s.saveTasks(sc.tasks);
      await s.saveWeek(sc.week);
      const { text } = await s.exportBackup();
      const before = JSON.parse(text).data;
      dbName = `scenario-b-${name}-${++n}`;
      const t = await open();
      await t.importBackup(text);
      const after = JSON.parse((await t.exportBackup()).text).data;
      // ההבדל היחיד המותר הוא חותמת הגיבוי של הייצוא השני
      after.settings.lastBackupAt = before.settings.lastBackupAt;
      expect(after, name).toEqual(before);
    }
  });
});

describe('ייבוא קובץ פגום נדחה בלי לפגוע בנתונים', () => {
  async function snapshot() {
    return JSON.stringify({
      s: await store.getSettings(), c: await store.listCategories(), t: await store.listTasks(), w: await store.listWeeks(),
    });
  }
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- נתוני בדיקה שמושחתים בכוונה */
  type Json = any;
  const mutate = (text: string, fn: (f: Json) => void) => {
    const f = JSON.parse(text) as Json;
    fn(f);
    return JSON.stringify(f);
  };

  it.each<[string, (t: string) => string]>([
    ['לא JSON', () => '{not json'],
    ['מערך במקום אובייקט', () => '[]'],
    ['אפליקציה זרה', (t) => mutate(t, (f) => { f.app = 'other'; })],
    ['פורמט לא מוכר', (t) => mutate(t, (f) => { f.backupVersion = 42; })],
    ['חסר data', (t) => mutate(t, (f) => { delete f.data; })],
    ['חסרות משימות', (t) => mutate(t, (f) => { delete f.data.tasks; })],
    ['טיפוס שגוי בשדה משימה', (t) => mutate(t, (f) => { f.data.tasks[0].durationMin = 'שעה'; })],
    ['ערך enum לא חוקי', (t) => mutate(t, (f) => { f.data.tasks[0].priority = 'urgent'; })],
    ['תאריך לא קיים', (t) => mutate(t, (f) => { f.data.weeks[0].startDate = '2026-02-31'; })],
    ['שבוע שלא מתחיל ביום ראשון', (t) => mutate(t, (f) => { f.data.weeks[0].startDate = '2026-10-05'; })],
    ['קטגוריה שלא קיימת', (t) => mutate(t, (f) => { f.data.tasks[0].categoryId = 'ghost'; })],
    ['מזהה משימה כפול', (t) => mutate(t, (f) => { f.data.tasks[1].id = f.data.tasks[0].id; })],
    ['שבוע מפנה למשימה שאינה קיימת', (t) => mutate(t, (f) => { f.data.weeks[0].taskIds.push('ghost'); })],
    ['סידור נבחר לא קיים', (t) => mutate(t, (f) => { f.data.weeks[0].selectedScheduleId = 'ghost'; })],
    ['שעות שינה ברירת מחדל', (t) => mutate(t, (f) => { f.data.settings.sleepStart = 1380; })],
    ['יותר מ-11 קטגוריות', (t) => mutate(t, (f) => { for (let i = 0; i < 12; i++) f.data.categories.push({ ...f.data.categories[0], id: `e${i}` }); })],
    ['קובץ קטוע', (t) => t.slice(0, t.length / 2)],
  ])('נדחה: %s', async (_name, corrupt) => {
    await load();
    const { text } = await store.exportBackup();
    const before = await snapshot();
    await expect(store.importBackup(corrupt(text))).rejects.toBeInstanceOf(BackupError);
    expect(await snapshot()).toBe(before);
  });

  it('BackupError מכיל רשימת בעיות', async () => {
    await load();
    const { text } = await store.exportBackup();
    const bad = mutate(text, (f) => { f.data.tasks[0].priority = 'x'; });
    const err = await store.importBackup(bad).catch((e: unknown) => e);
    expect((err as BackupError).problems.length).toBeGreaterThan(0);
  });

  it('כשל באמצע הכתיבה מבטל את כל הייבוא (אטומיות)', async () => {
    await load();
    const { text } = await store.exportBackup();
    const before = await snapshot();
    // עובר אימות, אך נכשל בכתיבה: מפתח לא תקין למשימה אחת
    const data = parseBackup(text);
    const poisoned = { ...data, tasks: [...data.tasks, { ...data.tasks[0]!, id: { bad: true } as unknown as string }] };
    const raw = await openDB(dbName);
    const tx = raw.transaction(['tasks', 'weeks'], 'readwrite');
    await tx.objectStore('tasks').clear();
    await expect(
      (async () => { for (const t of poisoned.tasks) await tx.objectStore('tasks').put(t); })(),
    ).rejects.toBeDefined();
    await tx.done.catch(() => undefined);
    raw.close();
    expect(await snapshot()).toBe(before);
  });

  it('validateData מקבל נתונים תקינים', async () => {
    await load();
    const { file } = await store.exportBackup();
    expect(validateData(file.data)).toEqual([]);
  });
});

describe('אחסון מתמשך', () => {
  it('אושר עכשיו', async () => {
    let asked = 0;
    const r = await requestPersistence({ persisted: async () => false, persist: async () => { asked++; return true; } });
    expect(r).toEqual({ status: 'granted', persisted: true });
    expect(asked).toBe(1);
  });

  it('כבר מתמשך: לא מבקש שוב', async () => {
    let asked = 0;
    const r = await requestPersistence({ persisted: async () => true, persist: async () => { asked++; return true; } });
    expect(r).toEqual({ status: 'already', persisted: true });
    expect(asked).toBe(0);
  });

  it('לא אושר: מדווח בלי לזרוק, והאחסון ממשיך לעבוד', async () => {
    const r = await requestPersistence({ persisted: async () => false, persist: async () => false });
    expect(r).toEqual({ status: 'denied', persisted: false });
    await load();
    expect(await store.listTasks()).not.toHaveLength(0);
  });

  it('הבקשה זורקת: מטופל כ"לא אושר"', async () => {
    const r = await requestPersistence({ persist: async () => { throw new Error('boom'); } });
    expect(r).toEqual({ status: 'denied', persisted: false });
  });

  it('דפדפן ללא תמיכה', async () => {
    expect(await requestPersistence(undefined)).toEqual({ status: 'unsupported', persisted: false });
    expect(await requestPersistence({})).toEqual({ status: 'unsupported', persisted: false });
  });
});

describe('תזכורת גיבוי', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('מעולם לא גובה: מוצגת תזכורת', () => {
    expect(backupReminder(undefined, now)).toEqual({ due: true, daysSince: null, lastBackupAt: undefined });
  });
  it('לפני שבוע: אין תזכורת', () => {
    expect(backupReminder('2026-10-04T12:00:00Z', now)).toMatchObject({ due: false, daysSince: 6 });
  });
  it('שבוע בדיוק ויותר: יש תזכורת', () => {
    expect(backupReminder('2026-10-03T12:00:00Z', now)).toMatchObject({ due: true, daysSince: 7 });
    expect(backupReminder('2026-08-01T00:00:00Z', now).due).toBe(true);
  });
  it('תאריך לא תקין או עתידי', () => {
    expect(backupReminder('garbage', now).due).toBe(true);
    expect(backupReminder('2027-01-01T00:00:00Z', now)).toMatchObject({ due: false, daysSince: 0 });
  });
  it('אחרי ייצוא אין תזכורת', async () => {
    const { file } = await store.exportBackup();
    expect(backupReminder(file.data.settings.lastBackupAt, new Date('2026-10-04T10:00:00Z')).due).toBe(false);
  });
});
