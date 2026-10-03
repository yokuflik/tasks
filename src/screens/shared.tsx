import type { ComponentChildren, JSX } from 'preact';
import type { Category, ExceptionsReport, IsoDate, Task } from '../contracts';
import { addDays, specialDaysOn, weekdayOf } from '../time';
import { Badge, Button, HolidayBadge, Icon, formatDuration } from '../ui';
import { REASON_LABEL, WEEKDAY_NAMES, shortDate } from './model';
import type { ScreenProps } from './types';

/** שם בעלת האפליקציה: מופיע בכותרת, בברכה ובמצבים ריקים. */
export const OWNER_NAME = 'תהל';

export function weekdayName(date: IsoDate): string {
  return WEEKDAY_NAMES[weekdayOf(date)];
}

/** כותרת עם מעבר בין שבועות. */
export function WeekHeader({ title, weekStart, actions }: { title: string; weekStart: IsoDate; actions: ScreenProps['actions'] }): JSX.Element {
  return (
    <header class="scr-header">
      <h1 class="scr-title">{title}</h1>
      <div class="scr-weeknav">
        <button type="button" class="scr-iconbtn" aria-label="שבוע קודם" data-act="prev-week" onClick={() => actions.setWeekStart(addDays(weekStart, -7))}>›</button>
        <span class="scr-weeknav__label" data-testid="week-label">{shortDate(weekStart)}–{shortDate(addDays(weekStart, 6))}</span>
        <button type="button" class="scr-iconbtn" aria-label="שבוע הבא" data-act="next-week" onClick={() => actions.setWeekStart(addDays(weekStart, 7))}>‹</button>
      </div>
    </header>
  );
}

export function Empty({ text, children }: { text: string; children?: ComponentChildren }): JSX.Element {
  return (
    <div class="scr-empty">
      <span class="scr-empty__bloom" aria-hidden="true">🌸</span>
      <p>{text}</p>
      <p class="scr-empty__name">הכול מוכן בשבילך, {OWNER_NAME}</p>
      {children}
    </div>
  );
}

/** מצב בלי שבוע או בלי סידור נבחר, עם קישור למסך המתאים. */
export function NeedSchedule({ p }: { p: ScreenProps }): JSX.Element {
  return (
    <Empty text={p.week ? 'עדיין לא נבחר סידור לשבוע הזה.' : 'אין שבוע בתאריך הזה.'}>
      <Button onClick={() => p.actions.goto(p.week && p.week.schedules.length > 0 ? 'compare' : 'entry')}>
        {p.week && p.week.schedules.length > 0 ? 'לבחירת סידור' : 'להזנת השבוע'}
      </Button>
    </Empty>
  );
}

/** תגי שבת וחגים ליום, וסימון תאריך עברי. סימון בלבד. */
export function DayMarks({ date }: { date: IsoDate }): JSX.Element {
  return <>{specialDaysOn(date).map((d) => <HolidayBadge key={`${d.kind}-${d.name}`} day={d} />)}</>;
}

export function ExceptionsList({ report, tasks }: { report: ExceptionsReport; tasks: readonly Task[] }): JSX.Element | null {
  const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? id;
  if (report.unplaced.length === 0 && report.sleepShortfalls.length === 0) return null;
  return (
    <section class="scr-exceptions" aria-label="דוח חריגים">
      <h2 class="scr-h2"><Icon name="warning" size={18} /> דוח חריגים</h2>
      <ul>
        {report.unplaced.map((u) => (
          <li key={u.taskId} data-reason={u.reason}>
            <strong>{title(u.taskId)}</strong> — {REASON_LABEL[u.reason]}
            {u.suggestion && <div class="scr-muted">{u.suggestion}</div>}
          </li>
        ))}
        {report.sleepShortfalls.map((s) => (
          <li key={s.date} data-shortfall={s.date}>
            לילה של {weekdayName(s.date)} {shortDate(s.date)}: אפשר לשמור רק {formatDuration(s.availableMin)} שינה במקום {formatDuration(s.requiredMin)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CategoryChip({ category }: { category: Category }): JSX.Element {
  return <Badge>{category.name}</Badge>;
}
