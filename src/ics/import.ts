import ICAL from 'ical.js';
import type { BlockedTime, IsoDate, Settings } from '../contracts';
import { addDays, dayDiff, epochMsToWall, wallToEpochMs } from './time';

export interface ImportOptions {
  timeZone: Settings['timeZone'];
  /** טווח תאריכים (כולל) שממנו מייבאים. אירועים חוזרים נפרשים רק בתוכו. */
  range: { start: IsoDate; end: IsoDate };
}

/** גבול ביטחון לפריסת אירוע חוזר. */
const MAX_OCCURRENCES = 1000;

export class IcsParseError extends Error {}

/**
 * מייבא קובץ ICS כזמנים חסומים (source: 'ics').
 * מדלג על אירועים מבוטלים ועל אירועים שמסומנים "פנוי" (TRANSP:TRANSPARENT).
 * אירוע יום שלם הופך לחסימה של כל יום. אירוע שחוצה חצות נשמר עם endMin מעל 1440.
 */
export function importIcsAsBlockedTimes(text: string, opts: ImportOptions): BlockedTime[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (e) {
    throw new IcsParseError(`קובץ ICS לא תקין: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (root.name !== 'vcalendar') throw new IcsParseError('קובץ ICS לא תקין: חסר VCALENDAR');

  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const name = String(tz.getFirstPropertyValue('tzid'));
    if (!ICAL.TimezoneService.has(name)) ICAL.TimezoneService.register(new ICAL.Timezone(tz));
  }

  // קיבוץ לפי UID: אירוע ראשי וחריגים (RECURRENCE-ID)
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  const singles: ICAL.Event[] = [];
  for (const comp of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(comp);
    if (comp.hasProperty('recurrence-id')) exceptions.push(ev);
    else if (ev.isRecurring()) masters.set(ev.uid, ev);
    else singles.push(ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else singles.push(ex);
  }

  const out: BlockedTime[] = [];
  const seen = new Set<string>();
  const push = (uid: string, ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (skip(ev)) return;
    for (const b of toBlocks(uid, ev.summary, start, end, opts)) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        out.push(b);
      }
    }
  };

  for (const ev of singles) push(ev.uid, ev, ev.startDate, ev.endDate);

  for (const master of masters.values()) {
    // קידום מהיר לתחילת הטווח (פחות יומיים, לאירועים שנמשכים), רק אם הוא אחרי תחילת האירוע
    const ff = ICAL.Time.fromDateTimeString(`${addDays(opts.range.start, -2)}T00:00:00`);
    const it = ff.compare(master.startDate) > 0 ? master.iterator(ff) : master.iterator();
    const limitMs = wallToEpochMs(addDays(opts.range.end, 1), 0, opts.timeZone);
    for (let n = 0, next = it.next(); next && n < MAX_OCCURRENCES; next = it.next(), n++) {
      const d = master.getOccurrenceDetails(next);
      if (toEpochMs(d.startDate, opts.timeZone) >= limitMs) break;
      push(master.uid, d.item, d.startDate, d.endDate);
    }
  }

  return out.sort((a, b) => a.range.date.localeCompare(b.range.date) || a.range.startMin - b.range.startMin || a.id.localeCompare(b.id));
}

function skip(ev: ICAL.Event): boolean {
  const c = ev.component;
  const status = String(c.getFirstPropertyValue('status') ?? '').toUpperCase();
  const transp = String(c.getFirstPropertyValue('transp') ?? '').toUpperCase();
  return status === 'CANCELLED' || transp === 'TRANSPARENT';
}

function toEpochMs(t: ICAL.Time, timeZone: string): number {
  if (t.isDate) return wallToEpochMs(isoOf(t), 0, timeZone);
  const zone = t.zone;
  // צף (ללא אזור) נחשב שעון קיר באזור הזמן של האפליקציה
  if (zone.tzid === 'floating') return wallToEpochMs(isoOf(t), t.hour * 60 + t.minute, timeZone);
  return t.toUnixTime() * 1000;
}

function isoOf(t: ICAL.Time): IsoDate {
  return `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function toBlocks(uid: string, summary: string | null, start: ICAL.Time, end: ICAL.Time, opts: ImportOptions): BlockedTime[] {
  const title = (summary ?? '').trim() || '(ללא כותרת)';
  const blocks: BlockedTime[] = [];
  const mk = (date: IsoDate, startMin: number, endMin: number) => {
    if (date > opts.range.end || addDays(date, Math.ceil(endMin / 1440) - 1) < opts.range.start) return;
    blocks.push({ id: `ics-${uid}-${date}-${startMin}`, title, range: { date, startMin, endMin }, source: 'ics' });
  };

  if (start.isDate) {
    // יום שלם: DTEND בלעדי. חסימה נפרדת לכל יום
    const first = isoOf(start);
    const days = Math.max(1, end.isDate ? dayDiff(first, isoOf(end)) : 1);
    for (let i = 0; i < days; i++) mk(addDays(first, i), 0, 1440);
    return blocks;
  }

  const startMs = toEpochMs(start, opts.timeZone);
  let endMs = toEpochMs(end, opts.timeZone);
  if (endMs <= startMs) endMs = startMs + 60_000;
  const s = epochMsToWall(startMs, opts.timeZone);
  const e = epochMsToWall(endMs, opts.timeZone);
  const span = dayDiff(s.date, e.date) * 1440 + e.min;
  if (span <= 2880) {
    mk(s.date, s.min, span);
  } else {
    // ארוך מ-48 שעות מההתחלה: פיצול לימים
    let date = s.date;
    let from = s.min;
    let remaining = span;
    while (remaining > from) {
      const to = Math.min(remaining, 1440);
      mk(date, from, to);
      remaining -= 1440;
      from = 0;
      date = addDays(date, 1);
    }
  }
  return blocks;
}
