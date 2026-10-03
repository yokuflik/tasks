import { openDB, type IDBPDatabase } from 'idb';
import type { Category, Settings, Task, Week } from '../contracts/index';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../contracts/defaults';
import { buildBackup, parseBackup, serializeBackup, type BackupFile } from './backup';
import { StorageError } from './errors';
import { DB_NAME, DB_VERSION, MIGRATIONS, SETTINGS_KEY, STORES, upgrade, type MigrationMap } from './schema';
import type { StoredData } from './validate';

export interface OpenOptions {
  /** שם מסד הנתונים. ברירת מחדל מתאימה לאפליקציה; משתנה רק בטסטים. */
  name?: string;
  /** לבדיקת מיגרציות בלבד. */
  version?: number;
  migrations?: MigrationMap;
  now?: () => Date;
}

export interface Storage {
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  listCategories(): Promise<Category[]>;
  saveCategory(category: Category): Promise<void>;
  /** נדחה אם משימה עדיין משתמשת בקטגוריה. */
  deleteCategory(id: string): Promise<void>;

  getTask(id: string): Promise<Task | undefined>;
  listTasks(): Promise<Task[]>;
  listTasksByWeek(weekId: string): Promise<Task[]>;
  saveTask(task: Task): Promise<void>;
  saveTasks(tasks: Task[]): Promise<void>;
  /** מנקה גם הפניות: taskIds בשבועות, dependsOn של משימות אחרות ובלוקים בסידורים. */
  deleteTask(id: string): Promise<void>;

  getWeek(id: string): Promise<Week | undefined>;
  getWeekByStartDate(startDate: string): Promise<Week | undefined>;
  listWeeks(): Promise<Week[]>;
  saveWeek(week: Week): Promise<void>;
  deleteWeek(id: string): Promise<void>;

  /** מפיק את קובץ הגיבוי ומעדכן את lastBackupAt. */
  exportBackup(): Promise<{ file: BackupFile; text: string }>;
  /** מאמת ואז מחליף את כל הנתונים בטרנזקציה אחת. קובץ פגום זורק BackupError ולא נוגע בכלום. */
  importBackup(text: string): Promise<void>;
  /** מוחק את כל הנתונים וחוזר לברירות מחדל. */
  resetAll(): Promise<void>;
  close(): void;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function openStorage(opts: OpenOptions = {}): Promise<Storage> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? (() => new Date());
  const db: IDBPDatabase<unknown> = await openDB(opts.name ?? DB_NAME, opts.version ?? DB_VERSION, {
    async upgrade(d, oldV, newV, tx) {
      try {
        await upgrade(d, oldV, newV ?? DB_VERSION, tx, migrations);
      } catch {
        // מיגרציה שנכשלה מבטלת את השדרוג כולו, והמסד נשאר בגרסה הקודמת
        tx.done.catch(() => undefined);
        tx.abort();
      }
    },
  });

  const seedDefaults = async () => {
    const tx = db.transaction(['settings', 'categories'], 'readwrite');
    if ((await tx.objectStore('settings').get(SETTINGS_KEY)) === undefined) {
      await tx.objectStore('settings').put(DEFAULT_SETTINGS, SETTINGS_KEY);
      for (const c of DEFAULT_CATEGORIES) await tx.objectStore('categories').put(c);
    }
    await tx.done;
  };
  await seedDefaults();

  const readAll = async (): Promise<StoredData> => ({
    settings: (await db.get('settings', SETTINGS_KEY)) as Settings,
    categories: ((await db.getAll('categories')) as Category[]).sort(byId),
    tasks: ((await db.getAll('tasks')) as Task[]).sort(byId),
    weeks: ((await db.getAll('weeks')) as Week[]).sort(byId),
  });

  /** מחליף את כל התוכן בטרנזקציה אחת: או הכול או כלום. */
  const replaceAll = async (data: StoredData) => {
    const tx = db.transaction([...STORES], 'readwrite');
    for (const s of STORES) await tx.objectStore(s).clear();
    await tx.objectStore('settings').put(data.settings, SETTINGS_KEY);
    for (const c of data.categories) await tx.objectStore('categories').put(c);
    for (const t of data.tasks) await tx.objectStore('tasks').put(t);
    for (const w of data.weeks) await tx.objectStore('weeks').put(w);
    await tx.done;
  };

  return {
    async getSettings() {
      return ((await db.get('settings', SETTINGS_KEY)) as Settings | undefined) ?? { ...DEFAULT_SETTINGS };
    },
    async saveSettings(settings) {
      await db.put('settings', settings, SETTINGS_KEY);
    },

    async listCategories() {
      return ((await db.getAll('categories')) as Category[]).sort(byId);
    },
    async saveCategory(category) {
      await db.put('categories', category);
    },
    async deleteCategory(id) {
      const tx = db.transaction(['categories', 'tasks'], 'readwrite');
      const used = ((await tx.objectStore('tasks').getAll()) as Task[]).some((t) => t.categoryId === id);
      if (used) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new StorageError(`הקטגוריה ${id} בשימוש`);
      }
      await tx.objectStore('categories').delete(id);
      await tx.done;
    },

    async getTask(id) {
      return (await db.get('tasks', id)) as Task | undefined;
    },
    async listTasks() {
      return ((await db.getAll('tasks')) as Task[]).sort(byId);
    },
    async listTasksByWeek(weekId) {
      return ((await db.getAllFromIndex('tasks', 'weekId', weekId)) as Task[]).sort(byId);
    },
    async saveTask(task) {
      await db.put('tasks', task);
    },
    async saveTasks(tasks) {
      const tx = db.transaction('tasks', 'readwrite');
      for (const t of tasks) await tx.store.put(t);
      await tx.done;
    },
    async deleteTask(id) {
      const tx = db.transaction(['tasks', 'weeks'], 'readwrite');
      await tx.objectStore('tasks').delete(id);
      for (const t of (await tx.objectStore('tasks').getAll()) as Task[]) {
        if (t.dependsOn.includes(id)) await tx.objectStore('tasks').put({ ...t, dependsOn: t.dependsOn.filter((d) => d !== id) });
      }
      for (const w of (await tx.objectStore('weeks').getAll()) as Week[]) {
        const touched = w.taskIds.includes(id) || w.schedules.some((s) => s.blocks.some((b) => b.taskId === id));
        if (!touched) continue;
        await tx.objectStore('weeks').put({
          ...w,
          taskIds: w.taskIds.filter((x) => x !== id),
          schedules: w.schedules.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.taskId !== id) })),
        });
      }
      await tx.done;
    },

    async getWeek(id) {
      return (await db.get('weeks', id)) as Week | undefined;
    },
    async getWeekByStartDate(startDate) {
      return (await db.getFromIndex('weeks', 'startDate', startDate)) as Week | undefined;
    },
    async listWeeks() {
      return ((await db.getAll('weeks')) as Week[]).sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
    },
    async saveWeek(week) {
      await db.put('weeks', week);
    },
    async deleteWeek(id) {
      const tx = db.transaction(['weeks', 'tasks'], 'readwrite');
      await tx.objectStore('weeks').delete(id);
      for (const t of (await tx.objectStore('tasks').getAll()) as Task[]) {
        if (t.weekId !== id) continue;
        const rest: Partial<Task> = { ...t };
        delete rest.weekId;
        await tx.objectStore('tasks').put(rest);
      }
      await tx.done;
    },

    async exportBackup() {
      const exportedAt = now();
      const data = await readAll();
      data.settings = { ...data.settings, lastBackupAt: exportedAt.toISOString() };
      const file = buildBackup(data, exportedAt);
      const text = serializeBackup(file);
      // התאריך נשמר רק אחרי שהקובץ הופק בהצלחה
      await db.put('settings', data.settings, SETTINGS_KEY);
      return { file, text };
    },
    async importBackup(text) {
      const data = parseBackup(text);
      await replaceAll(data);
    },
    async resetAll() {
      const tx = db.transaction([...STORES], 'readwrite');
      for (const s of STORES) await tx.objectStore(s).clear();
      await tx.objectStore('settings').put(DEFAULT_SETTINGS, SETTINGS_KEY);
      for (const c of DEFAULT_CATEGORIES) await tx.objectStore('categories').put(c);
      await tx.done;
    },
    close() {
      db.close();
    },
  };
}
