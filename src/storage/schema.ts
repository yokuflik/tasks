import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { CONTRACT_VERSION } from '../contracts/index';

export const DB_NAME = 'weekly-task-planner';
/** גרסת מבנה ה-IndexedDB. עולה כשמוסיפים מיגרציה. תואמת לחוזה ב-P0. */
export const DB_VERSION = CONTRACT_VERSION;

export const STORES = ['settings', 'categories', 'tasks', 'weeks'] as const;
export type StoreName = (typeof STORES)[number];
export const SETTINGS_KEY = 'main';

export type UpgradeTx = IDBPTransaction<unknown, StoreNames<unknown>[], 'versionchange'>;
/** מיגרציה אחת: מעבירה מגרסה (version - 1) לגרסה version. רצה בתוך טרנזקציית השדרוג. */
export type Migration = (db: IDBPDatabase<unknown>, tx: UpgradeTx) => void | Promise<void>;
/** מפתח = הגרסה שאליה מגיעים. גרסה 1 היא יצירת המבנה ההתחלתי ואינה ברשימה. */
export type MigrationMap = Record<number, Migration>;

/** מיגרציות נתונים בקובץ גיבוי: מפתח = הגרסה שאליה מגיעים. */
export type DataMigration = (data: Record<string, unknown>) => Record<string, unknown>;
export type DataMigrationMap = Record<number, DataMigration>;

/** אין מיגרציות אמיתיות עדיין: גרסה 1 היא הראשונה. */
export const MIGRATIONS: MigrationMap = {};
export const DATA_MIGRATIONS: DataMigrationMap = {};

export function createInitialStores(db: IDBPDatabase<unknown>): void {
  db.createObjectStore('settings');
  db.createObjectStore('categories', { keyPath: 'id' });
  const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
  tasks.createIndex('weekId', 'weekId');
  const weeks = db.createObjectStore('weeks', { keyPath: 'id' });
  weeks.createIndex('startDate', 'startDate');
}

export async function upgrade(
  db: IDBPDatabase<unknown>,
  oldVersion: number,
  newVersion: number,
  tx: UpgradeTx,
  migrations: MigrationMap,
): Promise<void> {
  if (oldVersion < 1) createInitialStores(db);
  for (let v = Math.max(oldVersion, 1) + 1; v <= newVersion; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`חסרה מיגרציה לגרסה ${v}`);
    await step(db, tx);
  }
}

/** מעביר נתוני גיבוי ישנים לגרסה הנוכחית. */
export function migrateData(
  data: Record<string, unknown>,
  from: number,
  to: number,
  migrations: DataMigrationMap,
): Record<string, unknown> {
  let cur = data;
  for (let v = from + 1; v <= to; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`חסרה מיגרציית נתונים לגרסה ${v}`);
    cur = step(cur);
  }
  return cur;
}
