// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES } from '../contracts/defaults';
import type { Category, SpecialDay } from '../contracts';
import {
  AppFrame, Badge, Button, Card, CategoryDistributionBar, DayLoadBar, HolidayBadge, Icon, ShabbatColumn,
  SleepBand, TaskCard, TimeBlock, installTheme, loadLevel,
} from './index';

const cat = (id: string): Category => DEFAULT_CATEGORIES.find((c) => c.id === id)!;
let host: HTMLElement | undefined;

function mount(vnode: preact.ComponentChild): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(vnode, host!));
  return host;
}
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
  document.head.innerHTML = '';
});

describe('רכיבי בסיס', () => {
  it('כפתור: וריאנטים, לחיצה, ומושבת', () => {
    const onClick = vi.fn();
    const el = mount(<Button variant="secondary" onClick={onClick}>שמור</Button>);
    const b = el.querySelector('button')!;
    expect(b.className).toContain('ui-button--secondary');
    act(() => b.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    const d = mount(<Button disabled onClick={onClick}>כבוי</Button>).querySelector('button')!;
    act(() => d.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('כרטיס ותג', () => {
    const el = mount(<Card raised><Badge tone="primary">חדש</Badge></Card>);
    expect(el.querySelector('.ui-card--raised .ui-badge--primary')?.textContent).toBe('חדש');
  });
  it('מעטפת: RTL, עברית, וכפיית מצב', () => {
    const el = mount(<AppFrame theme="dark">x</AppFrame>);
    const f = el.firstElementChild!;
    expect(f.getAttribute('dir')).toBe('rtl');
    expect(f.getAttribute('lang')).toBe('he');
    expect(f.getAttribute('data-theme')).toBe('dark');
    const auto = mount(<AppFrame>x</AppFrame>).firstElementChild!;
    expect(auto.hasAttribute('data-theme')).toBe(false);
  });
  it('אייקון: כל אייקוני הקטגוריות קיימים, ושם לא מוכר לא מקריס', () => {
    for (const c of DEFAULT_CATEGORIES) {
      const el = mount(<Icon name={c.icon} />);
      if (/\p{Extended_Pictographic}/u.test(c.icon)) expect(el.textContent).toBe(c.icon);
      else expect(el.querySelector('path')?.getAttribute('d'), c.icon).toBeTruthy();
    }
    expect(mount(<Icon name="nope" />).querySelector('path')).toBeTruthy();
  });
  it('installTheme מזריק פעם אחת בלבד', () => {
    installTheme();
    installTheme();
    expect(document.querySelectorAll('#planner-theme-vars')).toHaveLength(1);
    expect(document.getElementById('planner-theme-vars')!.textContent).toContain('--bg:');
  });
});

describe('כרטיס משימה ובלוק זמן', () => {
  it('עבודה: קבועה עם סמל נעילה, בלי ידית גרירה', () => {
    const el = mount(<TaskCard title="משמרת בוקר" category={cat('work')} durationMin={480} startMin={420} endMin={900} />);
    const card = el.querySelector('.ui-task-card')!;
    expect(card.className).toContain('is-fixed');
    expect(card.querySelector('[data-icon="lock"]')).toBeTruthy();
    expect(card.querySelector('[data-icon="grip"]')).toBeNull();
    expect(card.textContent).toContain('07:00–15:00');
  });
  it('קטגוריה זזה: ידית גרירה, ולא נעילה', () => {
    const card = mount(<TaskCard title="ריצה" category={cat('fitness')} durationMin={45} effort="heavy" />).querySelector('.ui-task-card')!;
    expect(card.className).toContain('is-flexible');
    expect(card.querySelector('[data-icon="grip"]')).toBeTruthy();
    expect(card.querySelector('[data-icon="lock"]')).toBeNull();
    expect(card.textContent).toContain('45 ד׳');
    expect(card.textContent).toContain('כבד');
  });
  it('נעילה ידנית של משימה זזה מציגה נעילה', () => {
    const card = mount(<TaskCard title="x" category={cat('study')} durationMin={60} locked />).querySelector('.ui-task-card')!;
    expect(card.querySelector('[data-icon="lock"]')).toBeTruthy();
  });
  it('סימון בוצע: כפתור נגיש וקריאה חוזרת', () => {
    const toggle = vi.fn();
    const el = mount(<TaskCard title="x" category={cat('home')} durationMin={30} done onToggleDone={toggle} />);
    const b = el.querySelector<HTMLButtonElement>('.ui-task-card__done')!;
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.ui-task-card')!.className).toContain('is-done');
    act(() => b.click());
    expect(toggle).toHaveBeenCalled();
  });
  it('צבעי הקטגוריה מועברים כמשתנים לשני המצבים', () => {
    const card = mount(<TaskCard title="x" category={cat('family')} durationMin={30} />).querySelector<HTMLElement>('.ui-task-card')!;
    for (const v of ['--cl-bg', '--cl-text', '--cl-accent', '--cd-bg', '--cd-text', '--cd-accent']) {
      expect(card.style.getPropertyValue(v), v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('כותרת משתמש: dir=auto כדי שטקסט מעורב לא יתהפך', () => {
    const t = mount(<TaskCard title="Meeting עם דנה" category={cat('work')} durationMin={60} />).querySelector('h3')!;
    expect(t.getAttribute('dir')).toBe('auto');
  });
  it('בלוק זמן: שעות, גלישת חצות, וסגנון מיקום מהמסך', () => {
    const b = mount(<TimeBlock title="משמרת לילה" category={cat('work')} startMin={1320} endMin={1800} style={{ insetBlockStart: '10px' }} />).querySelector<HTMLElement>('.ui-time-block')!;
    expect(b.textContent).toContain('22:00–06:00');
    expect(b.style.insetBlockStart).toBe('10px');
    expect(b.className).toContain('is-fixed');
  });
});

describe('שינה', () => {
  it('רצועה עם שעות ומשך, נגישה, ובלי שעות מובנות', () => {
    const band = mount(<SleepBand startMin={1380} endMin={1440 + 480} />).querySelector('.ui-sleep-band')!;
    expect(band.getAttribute('aria-label')).toBe('שינה 23:00–08:00');
    expect(band.textContent).toContain('9 ש׳');
    expect(band.querySelector('[data-icon="moon"]')).toBeTruthy();
  });
  it('נעילה', () => {
    expect(mount(<SleepBand startMin={0} endMin={480} locked />).querySelector('[data-icon="lock"]')).toBeTruthy();
  });
});

describe('שבת וחגים: סימון בלבד', () => {
  const shabbat: SpecialDay = { date: '2026-10-10', kind: 'shabbat', name: 'שבת', hebrewDate: "כ״ח תשרי תשפ״ז", parasha: 'בראשית' };
  const holiday: SpecialDay = { date: '2026-09-22', kind: 'holiday', name: 'ראש השנה', hebrewDate: "י״א אלול" };
  const eve: SpecialDay = { date: '2026-09-21', kind: 'holiday_eve', name: 'ערב ראש השנה', hebrewDate: "x" };
  const chol: SpecialDay = { date: '2026-09-30', kind: 'chol_hamoed', name: 'חול המועד סוכות', hebrewDate: "x" };

  it('תג חג: סוג ושם נבדלים לכל סוג', () => {
    const kinds = [holiday, eve, chol, shabbat].map((d) => mount(<HolidayBadge day={d} />).querySelector('.ui-holiday-badge')!);
    expect(kinds.map((k) => k.getAttribute('data-kind'))).toEqual(['holiday', 'holiday_eve', 'chol_hamoed', 'shabbat']);
    expect(kinds[0]!.textContent).toContain('ראש השנה');
    expect(kinds[1]!.textContent).toContain('ערב חג');
    expect(kinds[2]!.textContent).toContain('חול המועד');
    // שבת: שם זהה לסוג, לא מוצג פעמיים
    expect(kinds[3]!.textContent).toBe('שבת');
  });
  it('עמודת שבת: כותרת, פרשה, תאריכים ותוכן', () => {
    const col = mount(<ShabbatColumn day={shabbat} dateLabel="10/10"><i class="child" /></ShabbatColumn>).querySelector('.ui-shabbat-column')!;
    expect(col.querySelector('header')!.textContent).toContain('שבת');
    expect(col.textContent).toContain('בראשית');
    expect(col.textContent).toContain('10/10');
    expect(col.textContent).toContain('תשפ״ז');
    expect(col.querySelector('.child')).toBeTruthy();
  });
  it('אין זמני כניסה ויציאה (הוחלט)', () => {
    const col = mount(<ShabbatColumn day={shabbat} dateLabel="10/10" />).querySelector('.ui-shabbat-column')!;
    expect(col.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    expect(col.textContent).not.toMatch(/כניסת|יציאת|הדלקת/);
  });
  it('אין שום חסימה: הרכיבים מציגים ואינם מוסיפים אזהרה כברירת מחדל', () => {
    const col = mount(<ShabbatColumn day={shabbat} dateLabel="10/10"><TimeBlock title="ריצה" category={cat('fitness')} startMin={600} endMin={660} /></ShabbatColumn>);
    expect(col.querySelector('[data-icon="warning"]')).toBeNull();
    expect(col.querySelector('.ui-time-block')).toBeTruthy();
  });
});

describe('סרגל עומס יומי', () => {
  it('רמות לפי יחס', () => {
    expect(loadLevel(0, 600)).toBe('low');
    expect(loadLevel(300, 600)).toBe('medium');
    expect(loadLevel(480, 600)).toBe('high');
    expect(loadLevel(700, 600)).toBe('over');
    expect(loadLevel(0, 0)).toBe('low');
    expect(loadLevel(30, 0)).toBe('over');
  });
  it('מילוי ונגישות', () => {
    const bar = mount(<DayLoadBar loadMin={300} availableMin={600} />).querySelector<HTMLElement>('.ui-load-bar')!;
    expect(bar.getAttribute('role')).toBe('meter');
    expect(bar.getAttribute('aria-valuenow')).toBe('300');
    expect(bar.querySelector<HTMLElement>('.ui-load-bar__fill')!.style.inlineSize).toBe('50%');
  });
  it('עומס יתר נחתך ל-100% אבל מסומן', () => {
    const bar = mount(<DayLoadBar loadMin={900} availableMin={600} />).querySelector<HTMLElement>('.ui-load-bar')!;
    expect(bar.className).toContain('ui-load-bar--over');
    expect(bar.querySelector<HTMLElement>('.ui-load-bar__fill')!.style.inlineSize).toBe('100%');
  });
});

describe('סרגל חלוקת קטגוריות', () => {
  const items = [
    { category: cat('work'), minutes: 1200 },
    { category: cat('study'), minutes: 400 },
    { category: cat('home'), minutes: 0 },
  ];
  it('קטעים לפי דקות, בלי קטגוריות ריקות', () => {
    const segs = [...mount(<CategoryDistributionBar items={items} />).querySelectorAll<HTMLElement>('.ui-distribution__segment')];
    expect(segs.map((s) => s.dataset['category'])).toEqual(['work', 'study']);
    expect(segs.map((s) => s.style.flexGrow)).toEqual(['1200', '400']);
  });
  it('מקרא עם אחוזים, וניתן להסתרה', () => {
    expect(mount(<CategoryDistributionBar items={items} />).querySelector('.ui-distribution__legend')!.textContent).toContain('75%');
    expect(mount(<CategoryDistributionBar items={items} legend={false} />).querySelector('.ui-distribution__legend')).toBeNull();
  });
  it('רשימה ריקה לא מקריסה', () => {
    expect(mount(<CategoryDistributionBar items={[]} />).querySelectorAll('.ui-distribution__segment')).toHaveLength(0);
  });
});

describe('כיווניות ברכיבים', () => {
  it('אין סגנון פיזי left/right בשום רכיב מרונדר', () => {
    const el = mount(
      <AppFrame>
        <TaskCard title="א" category={cat('work')} durationMin={60} />
        <TimeBlock title="ב" category={cat('study')} startMin={600} endMin={660} />
        <SleepBand startMin={0} endMin={480} />
        <DayLoadBar loadMin={1} availableMin={2} />
        <CategoryDistributionBar items={[{ category: cat('work'), minutes: 5 }]} />
      </AppFrame>,
    );
    expect(el.innerHTML).not.toMatch(/(^|[\s;"])(left|right|margin-left|margin-right|padding-left|padding-right)\s*:/);
  });
});
