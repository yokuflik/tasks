import type { ComponentChildren, JSX } from 'preact';
import type { Category, Effort, Minutes, Priority, SpecialDay } from '../contracts';
import { categoryStyleVars } from './tokens';

/** סגנון inline כמילון. מאפשר גם משתני CSS. */
export type StyleMap = Record<string, string | number>;
import { formatDuration, formatRange, formatTime } from './format';
import { Icon } from './icons';

const EFFORT_LABEL: Record<Effort, string> = { heavy: 'כבד', medium: 'בינוני', light: 'קל' };
const PRIORITY_LABEL: Record<Priority, string> = { low: 'עדיפות נמוכה', medium: 'עדיפות בינונית', high: 'עדיפות גבוהה' };

function catStyle(category: Category): StyleMap {
  return categoryStyleVars(category.color);
}

/**
 * משימה קבועה (עבודה): מסגרת מלאה וסמל נעילה.
 * משימה זזה: צבע רך וידית גרירה. נעילה ידנית מציגה גם סמל נעילה.
 */
function Marker({ fixed, locked }: { fixed: boolean; locked: boolean }): JSX.Element {
  if (fixed || locked) return <Icon name="lock" size={16} title={fixed ? 'קבוע' : 'נעול'} />;
  return <Icon name="grip" size={16} />;
}

export interface TaskCardProps {
  title: string;
  category: Category;
  durationMin: Minutes;
  effort?: Effort;
  priority?: Priority;
  startMin?: Minutes;
  endMin?: Minutes;
  locked?: boolean;
  done?: boolean;
  onToggleDone?: () => void;
}

/** כרטיס גדול לתצוגת יום. */
export function TaskCard(p: TaskCardProps): JSX.Element {
  const fixed = p.category.fixed;
  const locked = p.locked ?? false;
  const done = p.done ?? false;
  const cls = ['ui-task-card', fixed ? 'is-fixed' : 'is-flexible', locked ? 'is-locked' : '', done ? 'is-done' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <article class={cls} style={catStyle(p.category)} data-category={p.category.id}>
      <span class="ui-task-card__icon"><Icon name={p.category.icon} size={22} /></span>
      <div class="ui-task-card__body">
        <h3 class="ui-task-card__title" dir="auto">{p.title}</h3>
        <p class="ui-task-card__meta">
          <span>{p.category.name}</span>
          <span>{p.startMin !== undefined && p.endMin !== undefined ? formatRange(p.startMin, p.endMin) : formatDuration(p.durationMin)}</span>
          {p.effort && <span>{EFFORT_LABEL[p.effort]}</span>}
          {p.priority === 'high' && <span>{PRIORITY_LABEL.high}</span>}
        </p>
      </div>
      <Marker fixed={fixed} locked={locked} />
      {p.onToggleDone && (
        <button
          class="ui-task-card__done"
          type="button"
          aria-pressed={done}
          aria-label={done ? 'בטל סימון בוצע' : 'סמן כבוצע'}
          onClick={p.onToggleDone}
        >
          <Icon name="check" size={18} />
        </button>
      )}
    </article>
  );
}

export interface TimeBlockProps {
  title: string;
  category: Category;
  startMin: Minutes;
  endMin: Minutes;
  locked?: boolean;
  /** בלוק קצר (עד שעה): בלי טווח שעות, רק מה יש בו. */
  compact?: boolean;
  /** מיקום וגובה בתוך עמודת היום, בידי המסך. */
  style?: StyleMap;
}

/** בלוק קומפקטי ברשת השבוע. */
export function TimeBlock(p: TimeBlockProps): JSX.Element {
  const fixed = p.category.fixed;
  const locked = p.locked ?? false;
  const cls = ['ui-time-block', fixed ? 'is-fixed' : 'is-flexible', locked ? 'is-locked' : ''].filter(Boolean).join(' ');
  return (
    <div class={cls} style={{ ...catStyle(p.category), ...(p.style ?? {}) }} data-category={p.category.id}>
      <span class="ui-time-block__title" dir="auto">{p.title}</span>
      {!p.compact && <bdi dir="ltr" class="ui-time-block__time">{formatRange(p.startMin, p.endMin)}</bdi>}
      <Marker fixed={fixed} locked={locked} />
    </div>
  );
}

export interface SleepBandProps {
  startMin: Minutes;
  endMin: Minutes;
  locked?: boolean;
  /** הטקסט לא נכנס: בלי שעות ומשך (נשארים בתיאור הנגישות). */
  compact?: boolean;
  style?: StyleMap;
}

/** רצועת שינה: כהה ושקטה, ברורה כשמורה. */
export function SleepBand(p: SleepBandProps): JSX.Element {
  return (
    <div class={`ui-sleep-band${p.compact ? ' ui-sleep-band--compact' : ''}`} role="img" aria-label={`שינה ${formatRange(p.startMin, p.endMin)}`} {...(p.style ? { style: p.style } : {})}>
      <Icon name="moon" size={16} />
      <span>שינה</span>
      {!p.compact && (
        <span class="ui-sleep-band__time">
          <bdi dir="ltr" class="ui-sleep-band__range">
            <span class="ui-sleep-band__start">{formatTime(p.startMin)}</span>
            <span class="ui-sleep-band__end">{formatTime(p.endMin)}</span>
          </bdi>
          <bdi class="ui-sleep-band__dur">{formatDuration(p.endMin - p.startMin)}</bdi>
        </span>
      )}
      {p.locked && <Icon name="lock" size={14} title="נעול" />}
    </div>
  );
}

export interface TravelBandProps {
  startMin: Minutes;
  endMin: Minutes;
  /** רצועה צרה (רשת השבוע): בלי טקסט, רק סימון. */
  compact?: boolean;
  style?: StyleMap;
}

/** רצועת נסיעה: ריפוד לפני ואחרי משימה. */
export function TravelBand(p: TravelBandProps): JSX.Element {
  const label = `נסיעה ${formatRange(p.startMin, p.endMin)}`;
  if (p.compact) return <div class="ui-travel-band ui-travel-band--compact" role="img" aria-label={label} title={label} {...(p.style ? { style: p.style } : {})}><span>נסיעה</span></div>;
  return (
    <div class="ui-travel-band" role="img" aria-label={label} {...(p.style ? { style: p.style } : {})}>
      <Icon name="car" size={14} />
      <span>נסיעה</span>
      <span class="ui-travel-band__time">{formatDuration(p.endMin - p.startMin)}</span>
    </div>
  );
}

const SPECIAL_LABEL: Record<SpecialDay['kind'], string> = {
  shabbat: 'שבת',
  holiday: 'חג',
  holiday_eve: 'ערב חג',
  chol_hamoed: 'חול המועד',
};

/** תג חג: סימון בלבד. אין בו שעות. */
export function HolidayBadge({ day }: { day: SpecialDay }): JSX.Element {
  return (
    <span class={`ui-holiday-badge ui-holiday-badge--${day.kind}`} data-kind={day.kind} title={SPECIAL_LABEL[day.kind]}>
      <span class="ui-holiday-badge__kind">{SPECIAL_LABEL[day.kind]}</span>
      {day.name !== SPECIAL_LABEL[day.kind] && <span class="ui-holiday-badge__name">{day.name}</span>}
    </span>
  );
}

export interface ShabbatColumnProps {
  day: SpecialDay;
  /** תאריך לועזי להצגה, למשל "11/10". */
  dateLabel: string;
  /** תוכן העמודה. אין כאן זמני כניסה ויציאה. */
  children?: ComponentChildren;
}

/** עמודת יום שבת: רקע וגוון ייחודיים, כותרת ושם הפרשה, וקו מפריד. */
export function ShabbatColumn({ day, dateLabel, children }: ShabbatColumnProps): JSX.Element {
  return (
    <div class="ui-shabbat-column" data-date={day.date}>
      <header class="ui-shabbat-column__header">
        <strong>שבת</strong>
        {day.parasha && <span class="ui-shabbat-column__parasha">{day.parasha}</span>}
        <span class="ui-shabbat-column__dates">{dateLabel} · {day.hebrewDate}</span>
      </header>
      <div class="ui-shabbat-column__body">{children}</div>
    </div>
  );
}

export interface DayLoadBarProps {
  loadMin: Minutes;
  /** הזמן הפנוי ליום לצורך חישוב היחס. מגיע מהמסך, בלי ערך ברירת מחדל. */
  availableMin: Minutes;
}

export type LoadLevel = 'low' | 'medium' | 'high' | 'over';

export function loadLevel(loadMin: Minutes, availableMin: Minutes): LoadLevel {
  if (availableMin <= 0) return loadMin > 0 ? 'over' : 'low';
  const r = loadMin / availableMin;
  if (r > 1) return 'over';
  if (r >= 0.75) return 'high';
  if (r >= 0.4) return 'medium';
  return 'low';
}

/** סרגל עומס קטן בראש כל יום. */
export function DayLoadBar({ loadMin, availableMin }: DayLoadBarProps): JSX.Element {
  const ratio = availableMin > 0 ? Math.min(1, loadMin / availableMin) : loadMin > 0 ? 1 : 0;
  const level = loadLevel(loadMin, availableMin);
  return (
    <div
      class={`ui-load-bar ui-load-bar--${level}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={Math.max(availableMin, loadMin)}
      aria-valuenow={loadMin}
      aria-valuetext={`עומס ${formatDuration(loadMin)}`}
    >
      <span class="ui-load-bar__fill" style={{ inlineSize: `${Math.round(ratio * 100)}%` }} />
    </div>
  );
}

export interface DistributionItem {
  category: Category;
  minutes: Minutes;
}

export interface CategoryDistributionBarProps {
  items: DistributionItem[];
  legend?: boolean;
}

/** פס אחד שמראה את חלוקת הזמן בין קטגוריות. הקטע הראשון בצד ההתחלה (ימין ב-RTL). */
export function CategoryDistributionBar({ items, legend = true }: CategoryDistributionBarProps): JSX.Element {
  const shown = items.filter((i) => i.minutes > 0);
  const total = shown.reduce((s, i) => s + i.minutes, 0);
  return (
    <div class="ui-distribution">
      <div class="ui-distribution__bar" role="img" aria-label="חלוקת זמן לפי קטגוריות">
        {shown.map((i) => (
          <span
            key={i.category.id}
            class="ui-distribution__segment"
            data-category={i.category.id}
            style={{ ...catStyle(i.category), flexGrow: i.minutes, flexBasis: 0 }}
            title={`${i.category.name}: ${formatDuration(i.minutes)}`}
          />
        ))}
      </div>
      {legend && (
        <ul class="ui-distribution__legend">
          {shown.map((i) => (
            <li key={i.category.id} style={catStyle(i.category)}>
              <span class="ui-distribution__swatch" />
              {i.category.name} · {formatDuration(i.minutes)} ({Math.round((i.minutes / total) * 100)}%)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
