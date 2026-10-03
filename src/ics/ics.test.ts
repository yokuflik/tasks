import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../contracts/defaults';
import type { Schedule, ScheduleBlock, Task } from '../contracts';
import { exportScheduleToIcs, importIcsAsBlockedTimes, IcsParseError } from './index';
import { wallToEpochMs, epochMsToWall } from './time';

const NOW = new Date('2026-10-03T08:00:00Z');
const TZ = 'Asia/Jerusalem';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `משימה ${id}`,
    categoryId: 'study',
    durationMin: 60,
    priority: 'medium',
    constraints: {},
    flexibility: 'flexible',
    split: { splittable: false },
    dependsOn: [],
    effort: 'medium',
    timesPerWeek: 1,
    status: 'scheduled',
    ...over,
  };
}

function block(id: string, taskId: string | undefined, date: string, startMin: number, endMin: number, over: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return { id, kind: 'task', ...(taskId ? { taskId } : {}), range: { date, startMin, endMin }, locked: false, ...over };
}

function schedule(blocks: ScheduleBlock[]): Schedule {
  return {
    id: 's1',
    personality: 'balanced',
    seed: 1,
    score: { total: 0, placedCount: 0, totalCount: 0, breaksKept: 0, maxDayLoadMin: 0, penalties: {} },
    blocks,
    exceptions: { unplaced: [], sleepShortfalls: [] },
  };
}

const exp = (s: Schedule, tasks: Task[], opts = {}) =>
  exportScheduleToIcs(s, tasks, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, { now: NOW, ...opts });

function parseEvents(ics: string): ICAL.Event[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  return root.getAllSubcomponents('vevent').map((c) => new ICAL.Event(c));
}

describe('המרת זמן', () => {
  it('שעון קיר לרגע מוחלט, חורף וקיץ', () => {
    expect(new Date(wallToEpochMs('2026-01-15', 9 * 60, TZ)).toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(new Date(wallToEpochMs('2026-07-15', 9 * 60, TZ)).toISOString()).toBe('2026-07-15T06:00:00.000Z');
  });
  it('דקות מעל 1440 עוברות ליום הבא', () => {
    expect(new Date(wallToEpochMs('2026-01-15', 1500, TZ)).toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });
  it('הלוך ושוב', () => {
    const ms = wallToEpochMs('2026-03-27', 8 * 60 + 30, TZ);
    expect(epochMsToWall(ms, TZ)).toEqual({ date: '2026-03-27', min: 510 });
  });
});

describe('ייצוא', () => {
  it('הקובץ נטען בספריית קריאה (ical.js) עם כותרת, שעות, קטגוריה והערות', () => {
    const t = task('a', { title: 'פגישה', notes: 'להביא מחשב', categoryId: 'study' });
    const ics = exp(schedule([block('b1', 'a', '2026-01-15', 9 * 60, 10 * 60 + 30)]), [t]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const [ev] = parseEvents(ics);
    expect(ev?.summary).toBe('פגישה');
    expect(ev?.description).toBe('להביא מחשב');
    expect(ev?.component.getFirstPropertyValue('categories')).toBe('לימודים');
    expect(ev?.startDate.toJSDate().toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(ev?.endDate.toJSDate().toISOString()).toBe('2026-01-15T08:30:00.000Z');
  });

  it('אזור זמן נכון בקיץ ובחורף', () => {
    const tasks = [task('a')];
    const evs = parseEvents(
      exp(schedule([block('b1', 'a', '2026-01-15', 600, 660), block('b2', 'a', '2026-07-15', 600, 660, { segment: 1 })]), tasks),
    );
    expect(evs.map((e) => e.startDate.toJSDate().toISOString())).toEqual(['2026-01-15T08:00:00.000Z', '2026-07-15T07:00:00.000Z']);
  });

  it('יום מעבר שעון (27.3.2026): שעון הקיר נשמר', () => {
    const [ev] = parseEvents(exp(schedule([block('b1', 'a', '2026-03-27', 480, 540)]), [task('a')]));
    // ישראל עוברת לקיץ ב-27.3.2026 ב-02:00, ולכן 08:00 הוא UTC+3
    expect(ev?.startDate.toJSDate().toISOString()).toBe('2026-03-27T05:00:00.000Z');
  });

  it('אירוע שחוצה חצות', () => {
    const [ev] = parseEvents(exp(schedule([block('b1', 'a', '2026-01-15', 22 * 60, 26 * 60)]), [task('a')]));
    expect(ev?.startDate.toJSDate().toISOString()).toBe('2026-01-15T20:00:00.000Z');
    expect(ev?.endDate.toJSDate().toISOString()).toBe('2026-01-16T00:00:00.000Z');
    expect(ev?.duration.toSeconds()).toBe(4 * 3600);
  });

  it('אירוע יום שלם', () => {
    const [ev] = parseEvents(exp(schedule([block('b1', 'a', '2026-01-15', 0, 1440)]), [task('a')]));
    expect(ev?.startDate.isDate).toBe(true);
    expect(ev?.startDate.toString()).toBe('2026-01-15');
    expect(ev?.endDate.toString()).toBe('2026-01-16');
  });

  it('תווים בעברית, פסיקים, נקודה-פסיק ושורות חדשות מוצפנים ונקראים חזרה', () => {
    const t = task('a', { title: 'קנייה: חלב, ביצים; לחם', notes: 'שורה א\nשורה ב \\ סוף' });
    const ics = exp(schedule([block('b1', 'a', '2026-01-15', 600, 660)]), [t]);
    expect(ics).toContain('SUMMARY:קנייה: חלב\\, ביצים\\; לחם');
    const [ev] = parseEvents(ics);
    expect(ev?.summary).toBe(t.title);
    expect(ev?.description).toBe(t.notes);
  });

  it('קיפול שורות: אף שורה לא עוברת 75 בתים ולא נחתך תו', () => {
    const t = task('a', { title: 'א'.repeat(200), notes: 'ב'.repeat(300) });
    const ics = exp(schedule([block('b1', 'a', '2026-01-15', 600, 660)]), [t]);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const [ev] = parseEvents(ics);
    expect(ev?.summary).toBe(t.title);
    expect(ev?.description).toBe(t.notes);
  });

  it('ייצוא חוזר: זהה בייט לבייט, ומזהים יציבים גם אחרי הזזת בלוק', () => {
    const tasks = [task('a'), task('b')];
    const s1 = schedule([block('x1', 'a', '2026-01-15', 600, 660), block('x2', 'b', '2026-01-16', 600, 660)]);
    expect(exp(s1, tasks)).toBe(exp(s1, tasks));
    const s2 = schedule([block('y1', 'a', '2026-01-17', 700, 760), block('y2', 'b', '2026-01-16', 600, 660)]);
    const uids = (s: Schedule) => parseEvents(exp(s, tasks)).map((e) => e.uid).sort();
    expect(uids(s2)).toEqual(uids(s1));
    expect(new Set(uids(s1)).size).toBe(2);
  });

  it('מקטעים של אותה משימה מקבלים UID שונים', () => {
    const s = schedule([block('b1', 'a', '2026-01-15', 600, 660, { segment: 0 }), block('b2', 'a', '2026-01-16', 600, 660, { segment: 1 })]);
    expect(new Set(parseEvents(exp(s, [task('a')])).map((e) => e.uid)).size).toBe(2);
  });

  it('שינה מיוצאת רק לפי בקשה', () => {
    const s = schedule([block('b1', 'a', '2026-01-15', 600, 660), { id: 'sl', kind: 'sleep', range: { date: '2026-01-15', startMin: 1380, endMin: 1380 + 540 }, locked: false }]);
    expect(parseEvents(exp(s, [task('a')]))).toHaveLength(1);
    expect(parseEvents(exp(s, [task('a')], { includeSleep: true }))).toHaveLength(2);
  });

  it('בלוק שהמשימה שלו חסרה מדולג', () => {
    expect(parseEvents(exp(schedule([block('b1', 'ghost', '2026-01-15', 600, 660)]), []))).toHaveLength(0);
  });
});

const wrap = (body: string, head = '') =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', head, body, 'END:VCALENDAR'].filter(Boolean).join('\r\n') + '\r\n';
const ev = (lines: string[]) => ['BEGIN:VEVENT', 'UID:u1@test', 'DTSTAMP:20260101T000000Z', ...lines, 'END:VEVENT'].join('\r\n');
const range = { start: '2026-01-11', end: '2026-01-17' };
const imp = (ics: string, r = range) => importIcsAsBlockedTimes(ics, { timeZone: TZ, range: r });

describe('ייבוא', () => {
  it('אירוע רגיל ב-UTC מומר לשעון קיר', () => {
    const [b] = imp(wrap(ev(['DTSTART:20260115T070000Z', 'DTEND:20260115T083000Z', 'SUMMARY:רופא'])));
    expect(b).toMatchObject({ title: 'רופא', source: 'ics', range: { date: '2026-01-15', startMin: 540, endMin: 630 } });
  });

  it('אירוע עם TZID ו-VTIMEZONE', () => {
    const tz = [
      'BEGIN:VTIMEZONE', 'TZID:America/New_York',
      'BEGIN:STANDARD', 'DTSTART:19701101T020000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
      'BEGIN:DAYLIGHT', 'DTSTART:19700308T020000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
      'END:VTIMEZONE',
    ].join('\r\n');
    const [b] = imp(wrap(ev(['DTSTART;TZID=America/New_York:20260115T090000', 'DTEND;TZID=America/New_York:20260115T100000', 'SUMMARY:x']), tz));
    // 09:00 בניו יורק (UTC-5) = 16:00 בישראל
    expect(b?.range).toEqual({ date: '2026-01-15', startMin: 960, endMin: 1020 });
  });

  it('אירוע צף נחשב שעון קיר מקומי', () => {
    const [b] = imp(wrap(ev(['DTSTART:20260115T090000', 'DTEND:20260115T100000', 'SUMMARY:x'])));
    expect(b?.range).toEqual({ date: '2026-01-15', startMin: 540, endMin: 600 });
  });

  it('אירוע שחוצה חצות נשמר עם endMin מעל 1440', () => {
    const [b] = imp(wrap(ev(['DTSTART:20260115T200000Z', 'DTEND:20260116T010000Z', 'SUMMARY:x']))); // 22:00-03:00
    expect(b?.range).toEqual({ date: '2026-01-15', startMin: 1320, endMin: 1620 });
  });

  it('אירוע יום שלם, ויום שלם מרובה ימים', () => {
    const one = imp(wrap(ev(['DTSTART;VALUE=DATE:20260115', 'DTEND;VALUE=DATE:20260116', 'SUMMARY:חופשה'])));
    expect(one.map((b) => b.range)).toEqual([{ date: '2026-01-15', startMin: 0, endMin: 1440 }]);
    const three = imp(wrap(ev(['DTSTART;VALUE=DATE:20260115', 'DTEND;VALUE=DATE:20260118', 'SUMMARY:חופשה'])));
    expect(three.map((b) => b.range.date)).toEqual(['2026-01-15', '2026-01-16', '2026-01-17']);
  });

  it('אירוע יום שלם בלי DTEND הוא יום אחד', () => {
    expect(imp(wrap(ev(['DTSTART;VALUE=DATE:20260115', 'SUMMARY:x'])))).toHaveLength(1);
  });

  it('תווים בעברית ומילוט נקראים נכון, כולל שורות מקופלות', () => {
    const [b] = imp(wrap(ev(['DTSTART:20260115T070000Z', 'DTEND:20260115T080000Z', 'SUMMARY:ארוחה\\, עם משפחה', ' ת']))); // המשך מקופל
    expect(b?.title).toBe('ארוחה, עם משפחהת');
  });

  it('אירוע חוזר שבועי נפרש רק בטווח המבוקש', () => {
    const r = imp(wrap(ev(['DTSTART:20260105T070000Z', 'DTEND:20260105T080000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'SUMMARY:חוג'])));
    expect(r.map((b) => b.range.date)).toEqual(['2026-01-12', '2026-01-14']);
    const wide = imp(wrap(ev(['DTSTART:20260105T070000Z', 'DTEND:20260105T080000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'SUMMARY:חוג'])), { start: '2026-01-01', end: '2026-01-31' });
    expect(wide).toHaveLength(8);
    expect(new Set(wide.map((b) => b.id)).size).toBe(8);
  });

  it('חזרה עם COUNT, EXDATE וחריג RECURRENCE-ID', () => {
    const master = ev(['DTSTART:20260111T070000Z', 'DTEND:20260111T080000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'EXDATE:20260112T070000Z', 'SUMMARY:ריצה']);
    const exception = [
      'BEGIN:VEVENT', 'UID:u1@test', 'DTSTAMP:20260101T000000Z', 'RECURRENCE-ID:20260113T070000Z',
      'DTSTART:20260113T150000Z', 'DTEND:20260113T160000Z', 'SUMMARY:ריצה מוזזת', 'END:VEVENT',
    ].join('\r\n');
    const r = imp(wrap(`${master}\r\n${exception}`));
    expect(r.map((b) => [b.range.date, b.range.startMin, b.title])).toEqual([
      ['2026-01-11', 540, 'ריצה'],
      ['2026-01-13', 17 * 60, 'ריצה מוזזת'],
      ['2026-01-14', 540, 'ריצה'],
      ['2026-01-15', 540, 'ריצה'],
    ]);
  });

  it('חזרה אינסופית נעצרת בסוף הטווח', () => {
    const r = imp(wrap(ev(['DTSTART:20200101T070000Z', 'DTEND:20200101T080000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:x'])));
    expect(r).toHaveLength(7);
  });

  it('מדלג על מבוטל ועל "פנוי", ומחוץ לטווח', () => {
    const cancelled = ev(['DTSTART:20260115T070000Z', 'DTEND:20260115T080000Z', 'STATUS:CANCELLED', 'SUMMARY:x']);
    const free = ev(['DTSTART:20260115T070000Z', 'DTEND:20260115T080000Z', 'TRANSP:TRANSPARENT', 'SUMMARY:x']);
    const outside = ev(['DTSTART:20260301T070000Z', 'DTEND:20260301T080000Z', 'SUMMARY:x']);
    expect(imp(wrap([cancelled, free, outside].join('\r\n')))).toEqual([]);
  });

  it('כותרת חסרה מקבלת שם ברירת מחדל', () => {
    expect(imp(wrap(ev(['DTSTART:20260115T070000Z', 'DTEND:20260115T080000Z'])))[0]?.title).toBe('(ללא כותרת)');
  });

  it('קובץ פגום נדחה', () => {
    expect(() => imp('זה לא קובץ ICS')).toThrow(IcsParseError);
    expect(() => imp('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n')).toThrow(IcsParseError);
  });
});

describe('ייצוא ואז ייבוא', () => {
  it('נותן חזרה את אותם זמנים, כולל חציית חצות ותווי עברית', () => {
    const tasks = [task('a', { title: 'סידורים, בנק' }), task('b')];
    const s = schedule([block('b1', 'a', '2026-01-12', 9 * 60 + 15, 10 * 60), block('b2', 'b', '2026-01-13', 22 * 60, 25 * 60)]);
    const back = imp(exp(s, tasks));
    expect(back.map((b) => [b.title, b.range])).toEqual([
      ['סידורים, בנק', { date: '2026-01-12', startMin: 555, endMin: 600 }],
      ['משימה b', { date: '2026-01-13', startMin: 1320, endMin: 1500 }],
    ]);
  });
});
