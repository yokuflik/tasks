/**
 * מחולל טבלת שבתות וחגים (P2). רץ בזמן פיתוח בלבד: node src/time/tools/generate-special-days.mjs
 * כותב את src/time/data/special-days.json. האפליקציה עצמה לא תלויה ב-@hebcal/core בזמן ריצה.
 * לוח ישראל (il: true), בלי זמני כניסת ויציאת שבת.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { HebrewCalendar, flags } from '@hebcal/core';

const FIRST_YEAR = 2025;
const LAST_YEAR = 2035;
const NO_NIKUD = 'he-x-NoNikud';

const iso = (d) => d.toLocaleDateString('sv');

const days = [];
const parashot = {};
for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
  const events = HebrewCalendar.calendar({
    year,
    il: true,
    sedrot: true,
    noMinorFast: true,
    noModern: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
  });
  for (const e of events) {
    const f = e.getFlags();
    const date = iso(e.getDate().greg());
    if (f & flags.PARSHA_HASHAVUA) {
      parashot[date] = e.render(NO_NIKUD).replace(/^פרשת /, '');
      continue;
    }
    let kind;
    if (f & flags.CHOL_HAMOED) kind = 'chol_hamoed';
    else if (f & flags.EREV && f & (flags.CHAG | flags.LIGHT_CANDLES)) kind = 'holiday_eve';
    else if (f & flags.CHAG) kind = 'holiday';
    if (!kind) continue;
    days.push({ date, kind, name: e.render(NO_NIKUD).replace(/ \d{4}$/, '') });
  }
}
days.sort((a, b) => a.date.localeCompare(b.date));

writeFileSync(
  new URL('../data/special-days.json', import.meta.url),
  JSON.stringify({ firstYear: FIRST_YEAR, lastYear: LAST_YEAR, days, parashot }, null, 1) + '\n',
);
process.stdout.write(`${days.length} special days, ${Object.keys(parashot).length} parashot\n`);
