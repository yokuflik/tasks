import type { IsoDate } from '../contracts';
import { generateInWorker, generateSchedules } from '../engine';
import type { GenerateInput, GeneratedSet } from '../engine';
import type { Storage } from '../storage';
import { openStorage, requestPersistence } from '../storage';
import type { PersistResult } from '../storage';
import { todayIso } from '../time';

/** כל מה שהמסכים צריכים מהעולם החיצוני. בטסטים מחליפים כל חלק. */
export interface AppServices {
  storage: Storage;
  generate(input: GenerateInput): Promise<GeneratedSet>;
  now(): Date;
  today(timeZone: string): IsoDate;
  /** הורדת קובץ (גיבוי, ICS). */
  download(fileName: string, text: string, mime: string): void;
  confirm(message: string): boolean;
  requestPersistence(): Promise<PersistResult>;
}

export function downloadInBrowser(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** עובד רקע כשאפשר, אחרת הרצה רגילה (למשל בסביבה בלי Worker). */
async function generateAnywhere(input: GenerateInput): Promise<GeneratedSet> {
  if (typeof Worker === 'undefined') return generateSchedules(input);
  try {
    return await generateInWorker(input);
  } catch {
    return generateSchedules(input);
  }
}

export async function createDefaultServices(): Promise<AppServices> {
  const storage = await openStorage();
  return {
    storage,
    generate: generateAnywhere,
    now: () => new Date(),
    today: (tz) => todayIso(tz),
    download: downloadInBrowser,
    confirm: (m) => window.confirm(m),
    requestPersistence: () => requestPersistence(),
  };
}
