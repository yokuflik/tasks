import { describe, expect, it } from 'vitest';
import {
  hebrewDate, holidaysInWeek, isCoveredByHolidayTable, shabbatOfWeek, specialDaysInRange,
  specialDaysInWeek, specialDaysOn, weekdayOf,
} from './index';
import { loadScenarios } from '../../fixtures';
import type { SpecialDayKind } from '../contracts';

const kindsOn = (date: string): SpecialDayKind[] => specialDaysOn(date).map((d) => d.kind);

describe('תאריך עברי', () => {
  it('ערכים ידועים, בגימטריה', () => {
    expect(hebrewDate('2026-04-02')).toBe('ט״ו בניסן תשפ״ו');
    expect(hebrewDate('2026-09-12')).toBe('א׳ בתשרי תשפ״ז');
    expect(hebrewDate('2026-09-21')).toBe('י׳ בתשרי תשפ״ז');
    expect(hebrewDate('2025-03-20')).toBe('כ׳ באדר תשפ״ה');
    expect(hebrewDate('2026-04-01')).toBe('י״ד בניסן תשפ״ו');
    expect(hebrewDate('2026-04-03')).toBe('ט״ז בניסן תשפ״ו');
  });

  it('שנה מעוברת: אדר ב׳', () => {
    expect(hebrewDate('2024-03-25')).toBe('ט״ו באדר ב׳ תשפ״ד');
  });

  it('מתחלף ביום הלועזי (לא בשקיעה)', () => {
    expect(hebrewDate('2026-09-11')).toBe('כ״ט באלול תשפ״ו');
    expect(hebrewDate('2026-09-12')).toBe('א׳ בתשרי תשפ״ז');
  });
});

describe('שבתות', () => {
  it('כל שבת מסומנת, ורק שבת', () => {
    const days = specialDaysInRange('2026-01-01', '2026-12-31').filter((d) => d.kind === 'shabbat');
    expect(days).toHaveLength(52);
    for (const d of days) expect(weekdayOf(d.date)).toBe(6);
    expect(kindsOn('2026-10-09')).toEqual([]); // שישי רגיל
  });

  it('שם הפרשה בשבת', () => {
    expect(specialDaysOn('2026-01-03')[0]).toMatchObject({ kind: 'shabbat', name: 'שבת', parasha: 'ויחי' });
    expect(specialDaysOn('2026-10-10')[0]).toMatchObject({ parasha: 'בראשית' });
  });

  it('שבת בחול המועד: בלי פרשה, ועם סימון חול המועד לצידה', () => {
    // 4.4.2026 שבת חול המועד פסח
    const d = specialDaysOn('2026-04-04');
    expect(d.map((x) => x.kind)).toEqual(['shabbat', 'chol_hamoed']);
    expect(d[0]?.parasha).toBeUndefined();
  });

  it('shabbatOfWeek', () => {
    expect(shabbatOfWeek('2026-10-07')).toBe('2026-10-10');
    expect(shabbatOfWeek('2026-10-04')).toBe('2026-10-10');
  });

  it('שבת מסומנת גם מחוץ לטווח הטבלה, בלי חגים', () => {
    expect(isCoveredByHolidayTable('2050-01-01')).toBe(false);
    expect(kindsOn('2050-01-01')).toEqual(['shabbat']);
  });

  it('אין זמני כניסה ויציאה בסימון', () => {
    expect(Object.keys(specialDaysOn('2026-10-10')[0] ?? {}).sort()).toEqual(
      ['date', 'hebrewDate', 'kind', 'name', 'parasha'],
    );
  });
});

describe('חגים: ערכים ידועים (לוח ישראל)', () => {
  const holiday = (date: string, kind: SpecialDayKind, name: string) => {
    expect(specialDaysOn(date)).toContainEqual(expect.objectContaining({ date, kind, name }));
  };

  it('ראש השנה, יום כיפור, סוכות, שמיני עצרת 2025', () => {
    holiday('2025-09-22', 'holiday_eve', 'ערב ראש השנה');
    holiday('2025-09-23', 'holiday', 'ראש השנה');
    holiday('2025-09-24', 'holiday', 'ראש השנה ב׳');
    holiday('2025-10-01', 'holiday_eve', 'ערב יום כיפור');
    holiday('2025-10-02', 'holiday', 'יום כיפור');
    holiday('2025-10-06', 'holiday_eve', 'ערב סוכות');
    holiday('2025-10-07', 'holiday', 'סוכות א׳');
    holiday('2025-10-14', 'holiday', 'שמיני עצרת');
  });

  it('פסח ושבועות 2026', () => {
    holiday('2026-04-01', 'holiday_eve', 'ערב פסח');
    holiday('2026-04-02', 'holiday', 'פסח א׳');
    holiday('2026-04-08', 'holiday', 'פסח ז׳');
    holiday('2026-05-21', 'holiday_eve', 'ערב שבועות');
    holiday('2026-05-22', 'holiday', 'שבועות');
  });

  it('2027: פסח, שבועות, ראש השנה', () => {
    holiday('2027-04-22', 'holiday', 'פסח א׳');
    holiday('2027-06-11', 'holiday', 'שבועות');
    holiday('2027-10-02', 'holiday', 'ראש השנה');
    holiday('2027-10-11', 'holiday', 'יום כיפור');
  });

  it('שמות בלי ניקוד ובלי שנה עברית', () => {
    const all = specialDaysInRange('2025-01-01', '2035-12-31');
    for (const d of all) {
      expect(d.name).not.toMatch(/[֑-ׇ]/);
      expect(d.name).not.toMatch(/\d/);
    }
  });

  it('בישראל חג בן יום אחד: אין שמיני עצרת נוסף ביום אחרי', () => {
    expect(kindsOn('2026-10-04')).toEqual([]); // 4.10.2026 ראשון רגיל
  });
});

describe('סוגי הימים', () => {
  it('חול המועד סוכות ופסח: חמישה/שישה ימים וכוללים הושענא רבה', () => {
    const sukkot = specialDaysInRange('2026-09-26', '2026-10-03');
    expect(sukkot.filter((d) => d.kind === 'chol_hamoed')).toHaveLength(6);
    expect(sukkot.find((d) => d.name.includes('הושענא רבה'))?.kind).toBe('chol_hamoed');
    const pesach = specialDaysInRange('2026-04-01', '2026-04-08');
    expect(pesach.filter((d) => d.kind === 'chol_hamoed')).toHaveLength(5);
  });

  it('ערב חג, חג וחול המועד נבדלים', () => {
    expect(kindsOn('2026-09-25')).toEqual(['holiday_eve']);
    expect(kindsOn('2026-09-26')).toEqual(['shabbat', 'holiday']);
    expect(kindsOn('2026-09-27')).toEqual(['chol_hamoed']);
  });

  it('אין חגים שאינם בארבעת הסוגים (פורים, חנוכה וכד׳ אינם מסומנים)', () => {
    expect(kindsOn('2026-03-03')).toEqual([]); // פורים
    expect(kindsOn('2026-12-04')).toEqual([]); // נר ראשון של חנוכה
    expect(kindsOn('2026-07-23')).toEqual([]); // תשעה באב
  });

  it('תאריך עברי מצורף לכל סימון', () => {
    for (const d of specialDaysInRange('2026-09-01', '2026-10-31')) {
      expect(d.hebrewDate).toMatch(/^[א-ת״׳]+ ב[א-ת׳ ]+ ת[א-ת״]+$/);
    }
  });
});

describe('אילו ימים הם חג בשבוע הזה', () => {
  it('שבוע חול המועד סוכות 2026 (27.9 עד 3.10)', () => {
    // השבוע של 27.9.2026 (ראשון) עד 3.10.2026 (שבת)
    const h = holidaysInWeek('2026-09-30');
    expect(h.map((d) => d.date)).toEqual([
      '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
    ]);
    expect(h.slice(0, 6).every((d) => d.kind === 'chol_hamoed')).toBe(true);
    expect(h[6]).toMatchObject({ kind: 'holiday', name: 'שמיני עצרת' });
  });

  it('שבוע פסח 2026 מתחיל בערב חג ביום רביעי', () => {
    const h = holidaysInWeek('2026-04-01');
    expect(h.map((d) => d.kind)).toEqual(['holiday_eve', 'holiday', 'chol_hamoed', 'chol_hamoed']);
  });

  it('שבוע רגיל: אין חגים, אבל יש שבת', () => {
    expect(holidaysInWeek('2026-10-14')).toEqual([]);
    const all = specialDaysInWeek('2026-10-14');
    expect(all.map((d) => d.kind)).toEqual(['shabbat']);
    expect(all[0]?.date).toBe('2026-10-17');
  });

  it('שבוע יום כיפור וערב סוכות', () => {
    const h = holidaysInWeek('2026-09-20');
    expect(h.map((d) => d.name)).toEqual(['ערב יום כיפור', 'יום כיפור', 'ערב סוכות', 'סוכות א׳']);
  });
});

describe('התאמה לתרחישי P0', () => {
  // התרחישים נוצרו מ-Intl; כאן הם מאומתים מול הטבלה. סוג, תאריך ותאריך עברי חייבים להתאים.
  // שמות חופשיים בתרחיש (למשל "חול המועד פסח") אינם נבדקים.
  for (const [name, sc] of Object.entries(loadScenarios())) {
    it(`${name}: הסימונים בתרחיש תואמים לחישוב`, () => {
      // ביום שבו שבת וחג חופפים אנחנו מחזירים שני סימונים, והתרחיש מכיל אחד (הראשון)
      const actual = specialDaysInWeek(sc.week.startDate).filter(
        (d, i, all) => all.findIndex((x) => x.date === d.date) === i,
      );
      expect(actual.map((d) => [d.date, d.kind, d.hebrewDate])).toEqual(
        sc.specialDays.map((d) => [d.date, d.kind, d.hebrewDate]),
      );
    });
  }
});
