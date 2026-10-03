import type { IsoDate, Minutes } from '../contracts';

/** תאריך ושעת קיר (דקות מחצות, יכולות לחרוג מ-1440) לרגע מוחלט במילישניות UTC, באזור זמן נתון. */
export function wallToEpochMs(date: IsoDate, min: Minutes, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, m - 1, d, 0, min);
  let guess = asUtc - tzOffsetMs(asUtc, timeZone);
  // איטרציה שנייה מתקנת מקרה שבו ההיסט שונה בין הניחוש לתוצאה (סביב מעבר שעון)
  guess = asUtc - tzOffsetMs(guess, timeZone);
  return guess;
}

/** רגע מוחלט לתאריך ושעת קיר באזור זמן נתון. */
export function epochMsToWall(ms: number, timeZone: string): { date: IsoDate; min: Minutes } {
  const p = partsOf(ms, timeZone);
  return { date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`, min: p.hour * 60 + p.minute };
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function dayDiff(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function partsOf(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const o: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') o[part.type] = Number(part.value);
  }
  return { year: o.year ?? 0, month: o.month ?? 0, day: o.day ?? 0, hour: o.hour ?? 0, minute: o.minute ?? 0, second: o.second ?? 0 };
}

function tzOffsetMs(ms: number, timeZone: string): number {
  const p = partsOf(ms, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}
