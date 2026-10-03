import type { IsoDate, Weekday } from '../../contracts';

/**
 * חשבון תאריכים מינימלי למנוע (UTC, בלי אזור זמן). מחליף זמנית את P2.
 * כשיהיה API יציב ב-src/time אפשר להחליף כאן בלי לגעת במנוע.
 */
const MS_DAY = 86_400_000;

export function toDayNumber(iso: IsoDate): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromDayNumber(n: number): IsoDate {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** כמה ימים מ-a עד b (חיובי אם b אחרי a). */
export function dayDiff(a: IsoDate, b: IsoDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** 0 = יום ראשון. */
export function weekdayOf(iso: IsoDate): Weekday {
  return new Date(toDayNumber(iso) * MS_DAY).getUTCDay() as Weekday;
}
