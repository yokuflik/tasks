import { CONTRACT_VERSION } from '../contracts/index';
import { BackupError } from './errors';
import { DATA_MIGRATIONS, migrateData, type DataMigrationMap } from './schema';
import { validateData, type StoredData } from './validate';

export const BACKUP_APP_ID = 'weekly-task-planner';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_REMINDER_DAYS = 7;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  backupVersion: number;
  /** גרסת סכמת הנתונים (Settings.schemaVersion) בזמן הייצוא. */
  schemaVersion: number;
  exportedAt: string;
  data: StoredData;
}

export function buildBackup(data: StoredData, exportedAt: Date): BackupFile {
  return {
    app: BACKUP_APP_ID,
    backupVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: data.settings.schemaVersion,
    exportedAt: exportedAt.toISOString(),
    data,
  };
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

/** שם קובץ מוצע לגיבוי, לפי תאריך הייצוא (UTC). */
export function backupFileName(exportedAt: Date): string {
  return `task-planner-backup-${exportedAt.toISOString().slice(0, 10)}.json`;
}

/**
 * מפענח ומאמת קובץ גיבוי. זורק BackupError עם רשימת בעיות אם הקובץ פגום, זר או חדש מדי.
 * לא נוגע באחסון, ולכן דחייה אף פעם לא פוגעת בנתונים קיימים.
 */
export function parseBackup(
  text: string,
  opts: { currentVersion?: number; migrations?: DataMigrationMap } = {},
): StoredData {
  const current = opts.currentVersion ?? CONTRACT_VERSION;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError(['הקובץ אינו JSON תקין']);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BackupError(['מבנה הקובץ לא מוכר']);
  const f = raw as Record<string, unknown>;
  if (f['app'] !== BACKUP_APP_ID) throw new BackupError(['הקובץ אינו גיבוי של האפליקציה הזו']);
  if (f['backupVersion'] !== BACKUP_FORMAT_VERSION) throw new BackupError(['גרסת פורמט הגיבוי לא נתמכת']);
  const version = f['schemaVersion'];
  if (!Number.isInteger(version) || (version as number) < 1) throw new BackupError(['גרסת סכמה לא תקינה']);
  if ((version as number) > current) throw new BackupError(['הגיבוי נוצר בגרסה חדשה יותר של האפליקציה']);
  const rawData = f['data'];
  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) throw new BackupError(['חסר מידע בקובץ']);

  let data: Record<string, unknown>;
  try {
    data = migrateData(rawData as Record<string, unknown>, version as number, current, opts.migrations ?? DATA_MIGRATIONS);
  } catch (e) {
    throw new BackupError([`המיגרציה נכשלה: ${e instanceof Error ? e.message : String(e)}`]);
  }
  const problems = validateData(data);
  if (problems.length > 0) throw new BackupError(problems);
  const out = data as unknown as StoredData;
  return { ...out, settings: { ...out.settings, schemaVersion: current } };
}

export interface BackupReminder {
  due: boolean;
  /** ימים מהגיבוי האחרון. null כשמעולם לא גובה. */
  daysSince: number | null;
  lastBackupAt: string | undefined;
}

/** תזכורת גיבוי שבועית. מעולם לא גובה או עברו intervalDays ימים = הגיע הזמן. */
export function backupReminder(
  lastBackupAt: string | undefined,
  now: Date,
  intervalDays: number = BACKUP_REMINDER_DAYS,
): BackupReminder {
  const t = lastBackupAt === undefined ? NaN : Date.parse(lastBackupAt);
  if (Number.isNaN(t)) return { due: true, daysSince: null, lastBackupAt };
  const daysSince = Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
  return { due: daysSince >= intervalDays, daysSince, lastBackupAt };
}
