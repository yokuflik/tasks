/**
 * תאריך עברי, שבתות וחגים (P2). סימון להצגה בלבד, אינו משפיע על שיבוץ.
 * חגים וחלוקת פרשות נטענים מטבלה שנוצרה בזמן פיתוח (tools/generate-special-days.mjs)
 * ולכן הכול עובד בלי רשת. תאריך עברי מחושב ב-Intl של הדפדפן.
 */
import type { IsoDate, SpecialDay, SpecialDayKind } from '../contracts';
import { addDays, dateRange, weekdayOf, weekDates } from './date';
import table from './data/special-days.json';

interface TableDay {
  date: IsoDate;
  kind: Exclude<SpecialDayKind, 'shabbat'>;
  name: string;
}

const holidays = new Map<IsoDate, TableDay[]>();
for (const d of table.days as TableDay[]) {
  const list = holidays.get(d.date) ?? [];
  list.push(d);
  holidays.set(d.date, list);
}
const parashot = table.parashot as Record<IsoDate, string>;

/** טווח השנים הלועזיות שבטבלה (כולל). מחוץ לו אין חגים ופרשות, ושבת עדיין מסומנת. */
export const SPECIAL_DAYS_FIRST_YEAR: number = table.firstYear;
export const SPECIAL_DAYS_LAST_YEAR: number = table.lastYear;

export function isCoveredByHolidayTable(date: IsoDate): boolean {
  const year = Number(date.slice(0, 4));
  return year >= SPECIAL_DAYS_FIRST_YEAR && year <= SPECIAL_DAYS_LAST_YEAR;
}

const hebrewFormatter = new Intl.DateTimeFormat('he-u-ca-hebrew', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/** מספר באותיות עבריות (גימטריה) עם גרש או גרשיים: 28 הופך ל-כ״ח, 10 ל-י׳. */
function gematriya(n: number): string {
  let rest = n;
  let out = '';
  while (rest >= 400) {
    out += 'ת';
    rest -= 400;
  }
  out += HUNDREDS[Math.floor(rest / 100)] ?? '';
  rest %= 100;
  if (rest === 15) out += 'טו';
  else if (rest === 16) out += 'טז';
  else out += (TENS[Math.floor(rest / 10)] ?? '') + (ONES[rest % 10] ?? '');
  return out.length === 1 ? `${out}׳` : `${out.slice(0, -1)}״${out.slice(-1)}`;
}

/** תאריך עברי להצגה, למשל "כ״ח בסיוון תשפ״ו". */
export function hebrewDate(date: IsoDate): string {
  const p: Record<string, string> = {};
  for (const part of hebrewFormatter.formatToParts(new Date(`${date}T12:00:00Z`))) {
    p[part.type] = part.value;
  }
  // בלי אלפים: 5786 הופך ל-786 (תשפ״ו)
  return `${gematriya(Number(p['day']))} ב${p['month']} ${gematriya(Number(p['year']) % 1000)}`;
}

/** הסימונים של יום אחד: שבת ראשונה אם יש, אחר כך חג. ריק ביום רגיל. */
export function specialDaysOn(date: IsoDate): SpecialDay[] {
  const result: SpecialDay[] = [];
  const heb = hebrewDate(date);
  if (weekdayOf(date) === 6) {
    const parasha = parashot[date];
    result.push({
      date,
      kind: 'shabbat',
      name: 'שבת',
      hebrewDate: heb,
      ...(parasha !== undefined ? { parasha } : {}),
    });
  }
  for (const h of holidays.get(date) ?? []) {
    result.push({ date, kind: h.kind, name: h.name, hebrewDate: heb });
  }
  return result;
}

/** כל הסימונים בטווח תאריכים (כולל קצוות), לפי סדר תאריכים. */
export function specialDaysInRange(from: IsoDate, to: IsoDate): SpecialDay[] {
  return dateRange(from, to).flatMap(specialDaysOn);
}

/** כל הסימונים בשבוע שמכיל את התאריך. */
export function specialDaysInWeek(date: IsoDate): SpecialDay[] {
  const days = weekDates(date);
  return specialDaysInRange(days[0] as IsoDate, days[6] as IsoDate);
}

/** "אילו ימים הם חג בשבוע הזה": חגים, ערבי חג וחול המועד. בלי שבתות. */
export function holidaysInWeek(date: IsoDate): SpecialDay[] {
  return specialDaysInWeek(date).filter((d) => d.kind !== 'shabbat');
}

/** תאריכי השבתות בשבוע (תמיד אחד: יום שבת). */
export function shabbatOfWeek(date: IsoDate): IsoDate {
  return addDays(weekDates(date)[0] as IsoDate, 6);
}
