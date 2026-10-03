import type { Category, Schedule, ScheduleBlock, Settings, Task } from '../contracts';
import { addDays, wallToEpochMs } from './time';

export const ICS_PRODID = '-//weekly-task-planner//HE';
const UID_DOMAIN = 'weekly-task-planner';

export interface ExportOptions {
  /** חותמת יצירה. ברירת מחדל: עכשיו. להעברה קבועה בטסטים כדי שייצוא חוזר יהיה זהה בייט לבייט. */
  now?: Date;
  /** האם לייצא גם בלוקי שינה. ברירת מחדל: לא. */
  includeSleep?: boolean;
}

/**
 * יוצר קובץ ICS מסידור נבחר. הזמנים מומרים לפי Settings.timeZone ונכתבים ב-UTC,
 * כך שהם נכונים גם סביב מעבר שעון קיץ בלי צורך ב-VTIMEZONE.
 * ה-UID נגזר ממשימה ומקטע (לא ממזהה הבלוק), ולכן ייצוא חוזר, גם אחרי הזזת בלוק, מעדכן ולא מכפיל.
 */
export function exportScheduleToIcs(
  schedule: Schedule,
  tasks: readonly Task[],
  categories: readonly Category[],
  settings: Pick<Settings, 'timeZone'>,
  opts: ExportOptions = {},
): string {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const stamp = formatUtc((opts.now ?? new Date()).getTime());
  const used = new Set<string>();

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${ICS_PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

  const blocks = [...schedule.blocks]
    .filter((b) => b.kind === 'task' || opts.includeSleep === true)
    .sort((a, b) => a.range.date.localeCompare(b.range.date) || a.range.startMin - b.range.startMin || a.id.localeCompare(b.id));

  for (const b of blocks) {
    const task = b.taskId !== undefined ? taskById.get(b.taskId) : undefined;
    if (b.kind === 'task' && !task) continue;
    const cat = task ? catById.get(task.categoryId) : undefined;

    let uid = stableUid(b);
    if (used.has(uid)) uid = `${uid}-${b.id}`;
    used.add(uid);

    const { date, startMin, endMin } = b.range;
    lines.push('BEGIN:VEVENT', `UID:${uid}@${UID_DOMAIN}`, `DTSTAMP:${stamp}`);
    if (startMin === 0 && endMin % 1440 === 0) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(date)}`, `DTEND;VALUE=DATE:${compactDate(addDays(date, endMin / 1440))}`);
    } else {
      lines.push(
        `DTSTART:${formatUtc(wallToEpochMs(date, startMin, settings.timeZone))}`,
        `DTEND:${formatUtc(wallToEpochMs(date, endMin, settings.timeZone))}`,
      );
    }
    lines.push(`SUMMARY:${escapeText(b.kind === 'sleep' ? 'שינה' : (task?.title ?? ''))}`);
    if (cat) lines.push(`CATEGORIES:${escapeText(cat.name)}`);
    if (task?.notes) lines.push(`DESCRIPTION:${escapeText(task.notes)}`);
    lines.push('TRANSP:OPAQUE', 'END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function stableUid(b: ScheduleBlock): string {
  if (b.kind === 'sleep') return `sleep-${b.range.date}`;
  return `task-${b.taskId ?? b.id}-${b.segment ?? 0}`;
}

function compactDate(date: string): string {
  return date.replaceAll('-', '');
}

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function escapeText(s: string): string {
  return s.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** קיפול שורות לפי RFC 5545: עד 75 בתים בשורה, בלי לחתוך תו UTF-8. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // רווח המשך תופס בית אחד
    }
    cur += ch;
    curBytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
