// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadScenarioFile as loadScenario } from './testing';
import type { IsoDate, Schedule, Task, Week } from '../contracts';
import { generateSchedules } from '../engine';
import { openStorage } from '../storage';
import type { Storage } from '../storage';
import { installTheme } from '../ui';
import { App } from './app';
import type { AppServices } from './services';

let dbCounter = 0;
let host: HTMLElement | undefined;
const opened: Storage[] = [];

interface Harness {
  services: AppServices;
  storage: Storage;
  downloads: { fileName: string; text: string; mime: string }[];
  confirmAnswer: { value: boolean };
}

async function makeHarness(opts: {
  today?: IsoDate; name?: string; generate?: AppServices['generate']; persisted?: boolean;
} = {}): Promise<Harness> {
  const storage = await openStorage({ name: opts.name ?? `screens-${++dbCounter}` });
  opened.push(storage);
  const downloads: Harness['downloads'] = [];
  const confirmAnswer = { value: true };
  const services: AppServices = {
    storage,
    generate: opts.generate ?? (async (input) => generateSchedules(input)),
    now: () => new Date('2026-06-07T09:00:00Z'), // 12:00 בירושלים
    today: () => opts.today ?? '2026-06-07',
    download: (fileName, text, mime) => { downloads.push({ fileName, text, mime }); },
    confirm: () => confirmAnswer.value,
    requestPersistence: async () => (opts.persisted ? { status: 'granted', persisted: true } : { status: 'denied', persisted: false }),
  };
  return { services, storage, downloads, confirmAnswer };
}

async function seed(h: Harness, name: string, withSchedules = true, select = 0): Promise<{ week: Week; tasks: Task[] }> {
  const sc = loadScenario(name);
  const week: Week = { ...sc.week, schedules: [] };
  const tasks = sc.tasks.map((t) => ({ ...t, weekId: week.id }));
  await h.storage.saveSettings(sc.settings);
  await h.storage.saveTasks(tasks);
  if (withSchedules) {
    const set = generateSchedules({ week, tasks, categories: sc.categories, settings: sc.settings });
    week.schedules = set.schedules;
    week.selectedScheduleId = (set.schedules[select] as Schedule).id;
  }
  await h.storage.saveWeek(week);
  return { week, tasks };
}

const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function until<T>(fn: () => T | null | undefined | false, what = 'condition', timeout = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${what}\n${host?.innerHTML.slice(0, 1500)}`);
    await sleep(15);
  }
}

async function mountApp(h: Harness): Promise<HTMLElement> {
  installTheme();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => { render(<App services={h.services} />, host!); });
  await until(() => host!.querySelector('[data-screen]'), 'app loaded');
  return host;
}

async function unmountApp(): Promise<void> {
  if (host) await act(async () => { render(null, host!); });
  host?.remove();
  host = undefined;
}

afterEach(async () => {
  await unmountApp();
  while (opened.length) opened.pop()!.close();
  try { localStorage.clear(); } catch { /* אין אחסון */ }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = host!.querySelector<T>(sel);
  if (!el) throw new Error(`לא נמצא: ${sel}`);
  return el;
};
const $$ = <T extends Element = HTMLElement>(sel: string): T[] => [...host!.querySelectorAll<T>(sel)];
const screenName = () => host!.querySelector('[data-screen]')?.getAttribute('data-screen');
const buttonByText = (text: string): HTMLButtonElement => {
  const b = $$<HTMLButtonElement>('button').find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`כפתור לא נמצא: ${text}`);
  return b;
};
const hasButton = (text: string) => $$<HTMLButtonElement>('button').some((x) => x.textContent?.trim() === text);

async function click(el: Element): Promise<void> {
  await act(async () => { (el as HTMLElement).click(); });
  await sleep(30);
}
async function setValue(el: Element, value: string): Promise<void> {
  await act(async () => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function setChecked(el: Element, checked: boolean): Promise<void> {
  await act(async () => {
    (el as HTMLInputElement).checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const nav = (id: string) => click($(`[data-nav="${id}"]`));

function pointer(type: string, init: { x?: number; y?: number } = {}): Event {
  const e = new MouseEvent(type, { bubbles: true, clientX: init.x ?? 0, clientY: init.y ?? 0 });
  return e;
}
async function fire(el: Element, type: string, init?: { x?: number; y?: number }): Promise<void> {
  await act(async () => { el.dispatchEvent(pointer(type, init)); });
}
async function tapBlock(blockId: string): Promise<void> {
  const el = $(`[data-block="${blockId}"]`);
  await fire(el, 'pointerdown');
  await fire(el, 'pointerup');
}

async function selectedFromStorage(h: Harness, weekId: string): Promise<{ week: Week; schedule: Schedule }> {
  const week = (await h.storage.getWeek(weekId))!;
  return { week, schedule: week.schedules.find((s) => s.id === week.selectedScheduleId)! };
}

describe('הזנת שבוע', () => {
  it('בלי שבוע: מציע ליצור, והשבוע נשמר ונשאר אחרי סגירה ופתיחה מחדש', async () => {
    const h = await makeHarness();
    await mountApp(h);
    expect(screenName()).toBe('entry');
    expect($('.scr-empty').textContent).toContain('עדיין אין שבוע');
    await click(buttonByText('צור שבוע חדש'));
    await until(() => host!.querySelector('[aria-label="משמרות השבוע"]'), 'entry form');
    expect((await h.storage.listWeeks())[0]?.startDate).toBe('2026-06-07');

    await unmountApp();
    await mountApp(h);
    expect($$('[aria-label="משמרות השבוע"]')).toHaveLength(1);
    expect($('[data-testid="week-label"]').textContent).toBe('7/6–13/6');
  });

  it('משמרות קודם, אחר כך משימות וזמנים חסומים', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await click(buttonByText('צור שבוע חדש'));
    const titles = $$('h2.scr-h2').map((x) => x.textContent ?? '');
    const iShift = titles.findIndex((t) => t.includes('משמרות'));
    const iTasks = titles.findIndex((t) => t.includes('משימות'));
    const iBlocked = titles.findIndex((t) => t.includes('זמנים חסומים'));
    expect(iShift).toBeGreaterThanOrEqual(0);
    expect(iShift).toBeLessThan(iTasks);
    expect(iTasks).toBeLessThan(iBlocked);
  });

  it('הוספת משמרת, כולל משמרת לילה שחוצה חצות, ומחיקה', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await click(buttonByText('צור שבוע חדש'));
    await setValue($('[name="shift-date"]'), '2026-06-08');
    await setValue($('[name="shift-start"]'), '22:00');
    await setValue($('[name="shift-end"]'), '06:30');
    await click(buttonByText('הוסף משמרת'));
    const li = await until(() => host!.querySelector('[data-shift]'), 'shift listed');
    expect(li.textContent).toContain('שני');
    const [saved] = await h.storage.listTasks();
    expect(saved).toMatchObject({ categoryId: 'work', flexibility: 'fixed', durationMin: 510 });
    expect(saved?.constraints).toEqual({ fixedDate: '2026-06-08', fixedStartMin: 1320 });

    await click($('[aria-label^="מחק משמרת"]'));
    await until(() => !host!.querySelector('[data-shift]'), 'shift removed');
    expect(await h.storage.listTasks()).toHaveLength(0);
  });

  it('שעה שגויה במשמרת מציגה שגיאה ולא שומרת', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await click(buttonByText('צור שבוע חדש'));
    await setValue($('[name="shift-start"]'), '');
    await click(buttonByText('הוסף משמרת'));
    expect($('[role="alert"]').textContent).toContain('שעה לא תקינה');
    expect(await h.storage.listTasks()).toHaveLength(0);
  });

  it('טופס משימה: אימות, שמירה, ואפשרויות מתקדמות', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await click(buttonByText('צור שבוע חדש'));
    await click(buttonByText('הוסף משימה'));
    expect(host!.textContent).toContain('חסרה כותרת');
    expect(await h.storage.listTasks()).toHaveLength(0);

    await setValue($('[name="title"]'), 'לקרוא מאמר');
    await setValue($('[name="duration"]'), '50');
    await click(buttonByText('הוסף משימה'));
    expect(host!.textContent).toContain('בכפולות של 15');

    await setValue($('[name="duration"]'), '90');
    await setValue($('[name="times"]'), '3');
    await click(buttonByText('עוד אפשרויות'));
    await setValue($('[name="fixed-start"]'), '10:00');
    await click(buttonByText('הוסף משימה'));
    expect(host!.textContent).toContain('שעה קבועה דורשת יום קבוע');

    await setValue($('[name="fixed-date"]'), '2026-06-09');
    await setChecked($('[name="splittable"]'), true);
    await click(buttonByText('הוסף משימה'));
    const li = await until(() => host!.querySelector('[data-task]'), 'task listed');
    expect(li.textContent).toContain('לקרוא מאמר');
    expect(li.textContent).toContain('3 פעמים');
    const [t] = await h.storage.listTasks();
    expect(t).toMatchObject({ title: 'לקרוא מאמר', durationMin: 90, timesPerWeek: 3, split: { splittable: true } });
    expect(t?.constraints).toEqual({ fixedDate: '2026-06-09', fixedStartMin: 600 });
    expect((await h.storage.listWeeks())[0]?.taskIds).toContain(t?.id);
    // הטופס מתאפס
    expect(($('[name="title"]') as HTMLInputElement).value).toBe('');
  });

  it('זמן חסום ידני, ייבוא ICS ומחיקה', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await click(buttonByText('צור שבוע חדש'));
    await setValue($('[name="blocked-title"]'), 'ארוחת צהריים');
    await setValue($('[name="blocked-date"]'), '2026-06-10');
    await click(buttonByText('הוסף זמן חסום'));
    const li = await until(() => host!.querySelector('[data-blocked]'), 'blocked listed');
    expect(li.textContent).toContain('ארוחת צהריים');
    expect(li.textContent).toContain('12:00–13:00');

    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', 'UID:one@test',
      'DTSTAMP:20260601T000000Z', 'DTSTART:20260608T070000Z', 'DTEND:20260608T080000Z', 'SUMMARY:פגישה', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const input = $('[name="ics-file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([ics], 'a.ics', { type: 'text/calendar' })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => $$('[data-blocked]').length === 2, 'ics imported');
    expect((await h.storage.listWeeks())[0]?.blockedTimes.some((b) => b.source === 'ics')).toBe(true);

    await click($('[aria-label="מחק ארוחת צהריים"]'));
    await until(() => $$('[data-blocked]').length === 1, 'blocked removed');
  });

  it('קובץ ICS פגום מדווח ולא פוגע', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await click(buttonByText('צור שבוע חדש'));
    const input = $('[name="ics-file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['זה לא ICS'], 'bad.ics')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => host!.textContent?.includes('קובץ ICS לא תקין'), 'ics error');
    expect((await h.storage.listWeeks())[0]?.blockedTimes).toEqual([]);
  });

  it('ימים פעילים, והעתקת משימות משבוע קודם', async () => {
    const h = await makeHarness({ today: '2026-06-14' });
    const prev = await seed(h, 'morning-shifts', false);
    await mountApp(h);
    await click(buttonByText('צור שבוע חדש'));
    await click($('[data-day="2026-06-20"]'));
    await until(async () => (await h.storage.getWeekByStartDate('2026-06-14'))?.activeDates.length === 6, 'day toggled');
    await click(buttonByText('העתק משימות משבוע קודם'));
    await until(async () => (await h.storage.listTasksByWeek('week-2026-06-14')).length > 0, 'copied');
    const copied = await h.storage.listTasksByWeek('week-2026-06-14');
    const original = prev.tasks.filter((t) => t.categoryId !== 'work');
    expect(copied).toHaveLength(original.length);
    expect(copied.some((t) => t.categoryId === 'work')).toBe(false);
    expect(copied.every((t) => t.status === 'pending')).toBe(true);
  });
});

describe('הפקה והשוואה', () => {
  it('מפיק שלושה סידורים ומציג אותם זה לצד זה עם ציון וסיכום', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts', false);
    await mountApp(h);
    expect(screenName()).toBe('entry');
    await click(buttonByText('הפק סידורים'));
    await until(() => screenName() === 'compare', 'compare screen');
    const cards = $$('[data-schedule]');
    expect(cards.map((c) => c.getAttribute('data-personality'))).toEqual(['balanced', 'early', 'themed']);
    for (const c of cards) {
      expect(c.textContent).toMatch(/ציון \d+/);
      expect(c.textContent).toContain('משימות נכנסו');
      expect(c.querySelectorAll('.scr-mini__day')).toHaveLength(7);
    }
    expect(cards[0]!.textContent).toContain('עומס מאוזן');
    expect(cards[1]!.textContent).toContain('הכול מוקדם');
    const saved = (await h.storage.listWeeks())[0]!;
    expect(saved.schedules).toHaveLength(3);
    expect(saved.selectedScheduleId).toBeUndefined();
  });

  it('הבדלים בין הוריאציות מודגשים', async () => {
    const h = await makeHarness();
    await seed(h, 'no-shifts-light', true);
    await mountApp(h);
    await nav('week');
    await click(buttonByText('החלפת סידור'));
    await until(() => screenName() === 'compare', 'compare');
    const counts = $$('[data-diff-count]').map((x) => Number(x.getAttribute('data-diff-count')));
    expect(counts).toHaveLength(3);
    expect(counts.some((n) => n > 0)).toBe(true);
    expect($$('.scr-mini__block.is-diff').length).toBeGreaterThan(0);
  });

  it('בחירת סידור שומרת ועוברת לתצוגת השבוע', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts', false);
    await mountApp(h);
    await click(buttonByText('הפק סידורים'));
    await until(() => screenName() === 'compare', 'compare');
    await click($$<HTMLButtonElement>('[data-personality="early"] button').find((b) => b.textContent === 'בחר סידור זה')!);
    await until(() => screenName() === 'week', 'week screen');
    const saved = (await h.storage.getWeek(week.id))!;
    expect(saved.schedules.find((s) => s.id === saved.selectedScheduleId)?.personality).toBe('early');
    // נשמר גם אחרי פתיחה מחדש
    await unmountApp();
    await mountApp(h);
    expect(screenName()).toBe('week');
  });

  it('שבוע עמוס מדי: דוח חריגים עם סיבה בכרטיס', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'overloaded-week', false);
    // חלונות של 8 שעות כדי שהשבוע יהיה עמוס בפועל
    await h.storage.saveWeek({ ...week, dayWindows: Object.fromEntries(week.activeDates.map((d) => [d, { startMin: 540, endMin: 1020 }])) });
    await mountApp(h);
    await click(buttonByText('הפק סידורים'));
    await until(() => screenName() === 'compare', 'compare');
    const items = $$('.scr-exceptions li[data-reason]');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.textContent).toMatch(/אין מספיק זמן|התנגשות|גדולה|אסורים|קבועה|תלות|שינה/);
  });

  it('במהלך הפקה הכפתור מושבת, ושגיאה מוצגת בלי לאבד נתונים', async () => {
    let reject!: (e: Error) => void;
    const h = await makeHarness({ generate: () => new Promise((_, rj) => { reject = rj; }) });
    await seed(h, 'morning-shifts', false);
    await mountApp(h);
    await click(buttonByText('הפק סידורים'));
    await until(() => hasButton('מפיק…'), 'busy label');
    expect(buttonByText('מפיק…').disabled).toBe(true);
    await act(async () => { reject(new Error('המנוע נכשל')); });
    await until(() => host!.querySelector('[role="alert"]'), 'error shown');
    expect($('[role="alert"]').textContent).toContain('המנוע נכשל');
    expect(hasButton('הפק סידורים')).toBe(true);
    expect(await h.storage.listTasks()).not.toHaveLength(0);
  });

  it('הפקה מחדש שומרת בלוקים נעולים במקומם', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts', true);
    await mountApp(h);
    await nav('week');
    const { schedule } = await selectedFromStorage(h, week.id);
    const gym = schedule.blocks.find((b) => b.taskId === 't-gym')!;
    await tapBlock(gym.id);
    await click(buttonByText('נעל'));
    await until(async () => (await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === gym.id)?.locked === true, 'locked');
    await nav('entry');
    await click(buttonByText('הפק מחדש'));
    await until(() => screenName() === 'compare', 'compare');
    const after = (await h.storage.getWeek(week.id))!;
    expect(after.schedules).toHaveLength(3);
    for (const s of after.schedules) {
      expect(s.blocks.find((b) => b.id === gym.id)?.range).toEqual(gym.range);
    }
  });
});

describe('תצוגת שבוע', () => {
  it('7 עמודות, שבת מסומנת בלי זמני כניסה ויציאה, ומשמרות נעולות', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    expect(screenName()).toBe('day');
    await nav('week');
    expect($$('.scr-col')).toHaveLength(7);
    const shabbat = $('.ui-shabbat-column');
    expect(shabbat.textContent).toContain('שבת');
    expect(shabbat.textContent).not.toMatch(/כניסת|יציאת|הדלקת/);
    expect($$('.scr-col__head').every((c) => c.querySelector('[role="meter"]'))).toBe(true);
    const shifts = $$('[data-kind="task"]').filter((el) => el.querySelector('.ui-time-block.is-fixed'));
    expect(shifts).toHaveLength(5);
    expect(shifts.every((el) => el.querySelector('[data-icon="lock"]'))).toBe(true);
    expect($$('[data-kind="sleep"]').length).toBeGreaterThanOrEqual(6);
  });

  it('חג באמצע השבוע מסומן אך לא חוסם: משימה מותרת בחג', async () => {
    const h = await makeHarness({ today: '2027-04-18' });
    const { week, tasks } = await seed(h, 'holiday-midweek');
    await mountApp(h);
    await nav('week');
    expect($('[data-special="holiday"]').getAttribute('data-date')).toBe('2027-04-22');
    expect($('[data-special="holiday_eve"]').getAttribute('data-date')).toBe('2027-04-21');
    expect($('[data-special="chol_hamoed"]').getAttribute('data-date')).toBe('2027-04-23');
    expect($('.ui-shabbat-column').getAttribute('data-date')).toBe('2027-04-24');
    // המשימה שהוגדרה לחג משובצת בו
    const { schedule } = await selectedFromStorage(h, week.id);
    const onHoliday = schedule.blocks.find((b) => b.taskId === 't-on-holiday')!;
    const fixedDate = tasks.find((t) => t.id === 't-on-holiday')?.constraints.fixedDate;
    if (fixedDate) expect(onHoliday.range.date).toBe(fixedDate);
    expect($(`[data-block="${onHoliday.id}"]`)).toBeTruthy();
  });

  it('לחיצה על בלוק פותחת פרטים; הזזה חוקית נשמרת; התנגשות נדחית', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('week');
    const { schedule } = await selectedFromStorage(h, week.id);
    const gym = schedule.blocks.find((b) => b.taskId === 't-gym')!;
    const shift = schedule.blocks.find((b) => b.taskId === 's-0')!;

    await tapBlock(gym.id);
    const sheet = await until(() => host!.querySelector('[role="dialog"]'), 'sheet');
    expect(sheet.textContent).toContain('t-gym');

    // התנגשות עם משמרת
    await setValue($('[name="move-date"]'), shift.range.date);
    await setValue($('[name="move-time"]'), '08:00');
    await click(buttonByText('הזז'));
    expect($('[role="dialog"] [role="alert"]').textContent?.length).toBeGreaterThan(0);
    expect((await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === gym.id)?.range).toEqual(gym.range);

    // הזזה חוקית לשבת
    await setValue($('[name="move-date"]'), '2026-06-13');
    await setValue($('[name="move-time"]'), '11:00');
    await click(buttonByText('הזז'));
    await until(() => !host!.querySelector('[role="dialog"]'), 'sheet closed');
    const moved = (await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === gym.id)!;
    expect(moved.range).toMatchObject({ date: '2026-06-13', startMin: 660 });
    expect($(`.ui-shabbat-column [data-block="${gym.id}"]`)).toBeTruthy();
  });

  it('משמרת קבועה: אי אפשר להזיז, ואין כפתור הזזה', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('week');
    const { schedule } = await selectedFromStorage(h, week.id);
    const shift = schedule.blocks.find((b) => b.taskId === 's-0')!;
    await tapBlock(shift.id);
    await until(() => host!.querySelector('[role="dialog"]'), 'sheet');
    expect($('[role="dialog"]').textContent).toContain('אי אפשר להזיז');
    expect(hasButton('הזז')).toBe(false);
    expect(hasButton('נעל')).toBe(false);
  });

  it('נעילה ושחרור מהפרטים, ובלוק נעול לא זז', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('week');
    const { schedule } = await selectedFromStorage(h, week.id);
    const study = schedule.blocks.find((b) => b.taskId === 't-study')!;
    await tapBlock(study.id);
    await click(buttonByText('נעל'));
    await until(async () => (await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === study.id)?.locked, 'locked');
    await tapBlock(study.id);
    await until(() => hasButton('שחרר נעילה'), 'unlock offered');
    expect(hasButton('הזז')).toBe(false);
    await click(buttonByText('שחרר נעילה'));
    await until(async () => !(await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === study.id)?.locked, 'unlocked');
  });

  it('לחיצה ארוכה נועלת בלי לפתוח פרטים', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('week');
    const { schedule } = await selectedFromStorage(h, week.id);
    const study = schedule.blocks.find((b) => b.taskId === 't-study')!;
    const el = $(`[data-block="${study.id}"]`);
    await fire(el, 'pointerdown');
    await sleep(520);
    await fire(el, 'pointerup');
    await until(async () => (await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === study.id)?.locked, 'long press lock');
    expect(host!.querySelector('[role="dialog"]')).toBeNull();
  });

  it('גרירה לעמודה ושעה אחרות מזיזה את הבלוק', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('week');
    const { schedule } = await selectedFromStorage(h, week.id);
    const study = schedule.blocks.find((b) => b.taskId === 't-study')!;
    const dates = week.activeDates;
    const starts = new Map(schedule.blocks.map((b) => [b.id, b.range.startMin]));
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      const colDate = el.dataset['colBody'];
      if (colDate) {
        const i = dates.indexOf(colDate);
        return { left: i * 100, right: i * 100 + 100, top: 0, bottom: 720, width: 100, height: 720, x: i * 100, y: 0, toJSON: () => ({}) };
      }
      const top = el.dataset['block'] ? (starts.get(el.dataset['block']) ?? 0) * 0.5 : 0;
      return { left: 0, right: 0, top, bottom: top, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
    });
    const el = $(`[data-block="${study.id}"]`);
    const grabY = study.range.startMin * 0.5 + 10; // 20 דקות מתחילת הבלוק
    await fire(el, 'pointerdown', { x: 50, y: grabY });
    await fire(el, 'pointermove', { x: 450, y: 16 * 60 * 0.5 + 10 });
    expect($('[data-ghost]')).toBeTruthy();
    await fire(el, 'pointerup', { x: 450, y: 16 * 60 * 0.5 + 10 });
    await until(async () => (await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === study.id)?.range.date === dates[4], 'dragged');
    const moved = (await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === study.id)!;
    expect(moved.range.startMin).toBe(16 * 60);
    expect(host!.querySelector('[data-ghost]')).toBeNull();
  });

  it('גרירה אל משמרת נדחית עם הודעה והבלוק נשאר', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('week');
    const { schedule } = await selectedFromStorage(h, week.id);
    const study = schedule.blocks.find((b) => b.taskId === 't-study')!;
    const dates = week.activeDates;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      const i = el.dataset['colBody'] ? dates.indexOf(el.dataset['colBody']) : 0;
      return { left: i * 100, right: i * 100 + 100, top: 0, bottom: 0, width: 100, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    const el = $(`[data-block="${study.id}"]`);
    await fire(el, 'pointerdown', { x: 50, y: 10 });
    await fire(el, 'pointermove', { x: 150, y: 8 * 60 * 0.5 });
    await fire(el, 'pointerup', { x: 150, y: 8 * 60 * 0.5 });
    await until(() => host!.querySelector('.scr-screen > [role="alert"]'), 'rejection shown');
    expect((await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === study.id)?.range).toEqual(study.range);
  });

  it('אזהרה עדינה על שבת/חג רק כשמופעלת בהגדרות', async () => {
    const h = await makeHarness();
    const { week } = await seed(h, 'morning-shifts');
    const { schedule } = await selectedFromStorage(h, week.id);
    const gym = schedule.blocks.find((b) => b.taskId === 't-gym')!;
    const moved = { ...schedule, blocks: schedule.blocks.map((b) => (b.id === gym.id ? { ...b, range: { date: '2026-06-13', startMin: 660, endMin: 660 + (gym.range.endMin - gym.range.startMin) } } : b)) };
    await h.storage.saveWeek({ ...(await h.storage.getWeek(week.id))!, schedules: (await h.storage.getWeek(week.id))!.schedules.map((s) => (s.id === moved.id ? moved : s)) });
    await mountApp(h);
    await nav('week');
    expect($$('.scr-warn')).toHaveLength(0);
    await nav('settings');
    await setChecked($('[name="warn-special"]'), true);
    await click(buttonByText('שמור הגדרות'));
    await nav('week');
    expect($$('.scr-warn').length).toBeGreaterThan(0);
  });

  it('ייצוא ICS מוריד קובץ עם האירועים', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('week');
    await click(buttonByText('ייצוא ליומן (ICS)'));
    expect(h.downloads).toHaveLength(1);
    expect(h.downloads[0]?.fileName).toBe('schedule-2026-06-07.ics');
    expect(h.downloads[0]?.text).toContain('BEGIN:VCALENDAR');
    expect(h.downloads[0]?.text.match(/BEGIN:VEVENT/g)?.length).toBeGreaterThanOrEqual(9);
  });

  it('בלי סידור נבחר מציע לבחור', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts', false);
    await mountApp(h);
    await nav('week');
    expect($('.scr-empty').textContent).toContain('לא נבחר סידור');
    await nav('day');
    expect($('.scr-empty')).toBeTruthy();
    await nav('overview');
    expect($('.scr-empty')).toBeTruthy();
  });
});

describe('תצוגת יום', () => {
  it('היום הנוכחי: כרטיסים, שינה, קו עכשיו, תאריך עברי ומשמרת נעולה', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    expect(screenName()).toBe('day');
    const label = $('[data-testid="day-label"]');
    expect(label.getAttribute('data-date')).toBe('2026-06-07');
    expect(label.textContent).toContain('ראשון');
    expect(label.textContent).toMatch(/[א-ת]+׳|״|ב[א-ת]/);
    expect($$('.ui-task-card.is-fixed').length).toBeGreaterThanOrEqual(1);
    expect($('.ui-task-card.is-fixed [data-icon="lock"]')).toBeTruthy();
    expect($$('.ui-sleep-band').length).toBeGreaterThanOrEqual(1);
    expect($$('[data-now]')).toHaveLength(1);
    // לא נותנים לסמן משמרת קבועה כבוצע בכפתור
    expect($$('.ui-task-card.is-fixed .ui-task-card__done')).toHaveLength(0);
  });

  it('קו עכשיו ממוקם אחרי מה שהתחיל לפני השעה', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    const kids = [...$('[data-timeline]').children];
    const nowIdx = kids.findIndex((k) => k.hasAttribute('data-now'));
    expect(nowIdx).toBeGreaterThan(0);
    // משמרת 07:00–15:00 כבר התחילה ולכן מופיעה לפני הקו
    expect(kids.slice(0, nowIdx).some((k) => k.querySelector('.ui-task-card.is-fixed'))).toBe(true);
  });

  it('סימון בוצע בכפתור ובהחלקה, וחוזר', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('day');
    await click($('.ui-task-card__done'));
    const doneId = (await h.storage.listTasks()).filter((t) => t.status === 'done');
    expect(doneId).toHaveLength(1);
    expect($$('.ui-task-card.is-done')).toHaveLength(1);
    await click($('.ui-task-card__done[aria-pressed="true"]'));
    expect((await h.storage.listTasks()).filter((t) => t.status === 'done')).toHaveLength(0);

    const row = $('.scr-swipe:has(.ui-task-card__done)');
    await fire(row, 'pointerdown', { x: 300, y: 10 });
    await fire(row, 'pointerup', { x: 120, y: 14 });
    await until(async () => (await h.storage.listTasks()).some((t) => t.status === 'done'), 'swipe done');

    // החלקה קצרה אינה סימון
    await h.storage.saveTasks((await h.storage.listTasks()).map((t) => ({ ...t, status: 'pending' as const })));
    await nav('week');
    await nav('day');
    const row2 = $('.scr-swipe:has(.ui-task-card__done)');
    await fire(row2, 'pointerdown', { x: 300, y: 10 });
    await fire(row2, 'pointerup', { x: 280, y: 10 });
    await sleep(40);
    expect((await h.storage.listTasks()).some((t) => t.status === 'done')).toBe(false);
  });

  it('ניווט בין ימים, ושבת מסומנת בלי זמני כניסה', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    expect(buttonByText('היום הקודם').disabled).toBe(true);
    for (let i = 0; i < 6; i++) await click(buttonByText('היום הבא'));
    expect($('[data-testid="day-label"]').getAttribute('data-date')).toBe('2026-06-13');
    expect(buttonByText('היום הבא').disabled).toBe(true);
    expect($('.scr-marks .ui-holiday-badge--shabbat')).toBeTruthy();
    expect(host!.textContent).not.toMatch(/כניסת|יציאת|הדלקת/);
    await click(buttonByText('היום הקודם'));
    expect($('[data-testid="day-label"]').getAttribute('data-date')).toBe('2026-06-12');
  });

  it('כשאין שבוע בתאריך של היום, מוצע ליצור אותו', async () => {
    const h = await makeHarness({ today: '2026-07-01' });
    await seed(h, 'morning-shifts');
    await mountApp(h);
    expect(screenName()).toBe('entry');
    await nav('day');
    expect($('.scr-empty').textContent).toContain('אין שבוע');
  });
});

describe('סקירת שבוע', () => {
  it('חלוקת קטגוריות, שינה ועומס לכל יום', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('overview');
    expect($('.ui-distribution__bar')).toBeTruthy();
    expect($('.ui-distribution__legend').textContent).toContain('עבודה');
    const rows = $$('.scr-days__row');
    expect(rows).toHaveLength(7);
    const sundayLoad = Number(rows[0]!.querySelector('[data-load]')!.getAttribute('data-load'));
    expect(sundayLoad).toBeGreaterThanOrEqual(480);
    const nights = rows.map((r) => Number(r.querySelector('[data-sleep]')!.getAttribute('data-sleep')));
    expect(nights.filter((n) => n >= 480).length).toBeGreaterThanOrEqual(6);
    expect(rows[6]!.querySelector('.ui-holiday-badge--shabbat')).toBeTruthy();
  });

  it('לילה עם חוסר שינה מוצג בדוח', async () => {
    const h = await makeHarness();
    await seed(h, 'adjacent-shifts');
    await mountApp(h);
    await nav('overview');
    const li = await until(() => host!.querySelector('[data-shortfall="2026-06-07"]'), 'shortfall listed');
    expect(li.textContent).toContain('שינה');
  });
});

describe('הגדרות וגיבוי', () => {
  it('הגדרות נשמרות, ערכים לא תקינים נדחים', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('settings');
    await setValue($('[name="min-break"]'), '30');
    await click(buttonByText('שמור הגדרות'));
    await until(async () => (await h.storage.getSettings()).minBreakMin === 30, 'saved');

    await setValue($('[name="target-sleep"]'), '5');
    await click(buttonByText('שמור הגדרות'));
    expect(host!.textContent).toContain('ערכים לא תקינים');
    expect((await h.storage.getSettings()).targetSleepMin).toBe(540);
  });

  it('שינוי שם וצבע של קטגוריה', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await nav('settings');
    const input = $('[name="cat-name-study"]') as HTMLInputElement;
    await act(async () => { input.value = 'אוניברסיטה'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(async () => (await h.storage.listCategories()).find((c) => c.id === 'study')?.name === 'אוניברסיטה', 'renamed');
    const color = $('[name="cat-color-study"]') as HTMLInputElement;
    await act(async () => { color.value = '#112233'; color.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(async () => (await h.storage.listCategories()).find((c) => c.id === 'study')?.color === '#112233', 'recolored');
    expect((await h.storage.listCategories())).toHaveLength(11);
  });

  it('תזכורת גיבוי, אחסון לא מתמשך, וייצוא מעדכן את התאריך', async () => {
    const h = await makeHarness();
    await mountApp(h);
    await nav('settings');
    expect($('[data-backup-due]').getAttribute('data-backup-due')).toBe('true');
    expect($('[data-persist="denied"]').textContent).toContain('אחסון מתמשך');
    await click(buttonByText('ייצוא גיבוי'));
    expect(h.downloads).toHaveLength(1);
    expect(h.downloads[0]?.fileName).toMatch(/^task-planner-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(h.downloads[0]?.mime).toBe('application/json');
    await until(() => host!.querySelector('[data-backup-due="false"]'), 'reminder cleared');
    expect(typeof (await h.storage.getSettings()).lastBackupAt).toBe('string');
  });

  it('אחסון מתמשך שאושר: אין אזהרה', async () => {
    const h = await makeHarness({ persisted: true });
    await mountApp(h);
    await nav('settings');
    await until(() => !host!.querySelector('[data-persist]'), 'no persist warning');
    expect(host!.querySelector('[data-persist]')).toBeNull();
  });

  it('גיבוי, מחיקה ושחזור מחזירים את הנתונים בדיוק', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('settings');
    await click(buttonByText('ייצוא גיבוי'));
    const backup = h.downloads[0]!.text;
    const before = {
      tasks: await h.storage.listTasks(), weeks: await h.storage.listWeeks(), categories: await h.storage.listCategories(),
    };

    h.confirmAnswer.value = false;
    await click(buttonByText('מחק את כל הנתונים'));
    expect(await h.storage.listTasks()).toHaveLength(before.tasks.length);

    h.confirmAnswer.value = true;
    await click(buttonByText('מחק את כל הנתונים'));
    await until(async () => (await h.storage.listTasks()).length === 0, 'reset');
    expect(await h.storage.listWeeks()).toHaveLength(0);

    const input = $('[name="backup-file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([backup], 'b.json', { type: 'application/json' })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => host!.textContent?.includes('הנתונים שוחזרו'), 'restored');
    expect(await h.storage.listTasks()).toEqual(before.tasks);
    expect(await h.storage.listWeeks()).toEqual(before.weeks);
    expect(await h.storage.listCategories()).toEqual(before.categories);
  });

  it('קובץ גיבוי פגום נדחה בלי לפגוע בנתונים', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('settings');
    const before = await h.storage.listTasks();
    const input = $('[name="backup-file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['{"not":"a backup"}'], 'bad.json')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => host!.textContent?.includes('השחזור נכשל'), 'import error');
    expect(host!.textContent).toContain('הנתונים לא שונו');
    expect(await h.storage.listTasks()).toEqual(before);
  });

  it('ביטול אישור שחזור לא נוגע בנתונים', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('settings');
    await click(buttonByText('ייצוא גיבוי'));
    const backup = h.downloads[0]!.text;
    h.confirmAnswer.value = false;
    const input = $('[name="backup-file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([backup], 'b.json')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(40);
    expect(host!.textContent).not.toContain('הנתונים שוחזרו');
  });
});

describe('ניווט ושמירת מצב', () => {
  it('הלשונית האחרונה נשמרת, וה-nav מסמן את הנוכחית', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('overview');
    expect($('[data-nav="overview"]').getAttribute('aria-current')).toBe('page');
    expect($('[data-nav="day"]').hasAttribute('aria-current')).toBe(false);
    await unmountApp();
    await mountApp(h);
    expect(screenName()).toBe('overview');
  });

  it('אחסון מקומי חסום לא שובר את האפליקציה', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await mountApp(h);
    expect(screenName()).toBe('day');
    await nav('week');
    expect(screenName()).toBe('week');
  });

  it('מעבר בין שבועות', async () => {
    const h = await makeHarness();
    await seed(h, 'morning-shifts');
    await mountApp(h);
    await nav('entry');
    await click($('[data-act="next-week"]'));
    expect($('[data-testid="week-label"]').textContent).toBe('14/6–20/6');
    expect($('.scr-empty').textContent).toContain('עדיין אין שבוע');
    await click($('[data-act="prev-week"]'));
    expect($('[data-testid="week-label"]').textContent).toBe('7/6–13/6');
  });

  it('RTL ועברית על המעטפת', async () => {
    const h = await makeHarness();
    await mountApp(h);
    const frame = $('.ui-frame');
    expect(frame.getAttribute('dir')).toBe('rtl');
    expect(frame.getAttribute('lang')).toBe('he');
    expect($$('nav button')).toHaveLength(5);
  });
});

describe('זרימה מלאה', () => {
  it('משתמש חדש: משמרות, משימות, שלושה סידורים, בחירה, עריכה, ICS, גיבוי, מחיקה ושחזור', async () => {
    const h = await makeHarness();
    await mountApp(h);

    // שבוע חדש ומשמרות קודם
    await click(buttonByText('צור שבוע חדש'));
    for (const [date, s, e] of [['2026-06-07', '07:00', '15:00'], ['2026-06-08', '07:00', '15:00'], ['2026-06-09', '22:00', '06:00']] as const) {
      await setValue($('[name="shift-date"]'), date);
      await setValue($('[name="shift-start"]'), s);
      await setValue($('[name="shift-end"]'), e);
      await click(buttonByText('הוסף משמרת'));
    }
    await until(() => $$('[data-shift]').length === 3, '3 shifts');

    // משימות
    for (const [title, cat, dur] of [['אימון', 'fitness', '60'], ['קניות', 'errands', '45'], ['לימוד', 'study', '120']] as const) {
      await setValue($('[name="title"]'), title);
      await setValue($('[name="category"]'), cat);
      await setValue($('[name="duration"]'), dur);
      await click(buttonByText('הוסף משימה'));
    }
    await until(() => $$('[data-task]').length === 3, '3 tasks');

    // זמן חסום
    await setValue($('[name="blocked-title"]'), 'ארוחה משפחתית');
    await setValue($('[name="blocked-date"]'), '2026-06-12');
    await setValue($('[name="blocked-start"]'), '13:00');
    await setValue($('[name="blocked-end"]'), '15:00');
    await click(buttonByText('הוסף זמן חסום'));
    await until(() => $$('[data-blocked]').length === 1, 'blocked');

    // הפקה והשוואה
    await click(buttonByText('הפק סידורים'));
    await until(() => screenName() === 'compare', 'compare');
    expect($$('[data-schedule]')).toHaveLength(3);
    await click($$<HTMLButtonElement>('[data-personality="balanced"] button').find((b) => b.textContent === 'בחר סידור זה')!);
    await until(() => screenName() === 'week', 'week');

    const week = (await h.storage.listWeeks())[0]!;
    const { schedule } = await selectedFromStorage(h, week.id);
    const taskTitles = new Map((await h.storage.listTasks()).map((t) => [t.id, t.title]));
    // כל משמרת במקומה, ולכל לילה בסידור שינה של 8 שעות לפחות או דוח
    for (const t of (await h.storage.listTasks()).filter((x) => x.flexibility === 'fixed')) {
      const b = schedule.blocks.find((x) => x.taskId === t.id)!;
      expect(b.range).toMatchObject({ date: t.constraints.fixedDate, startMin: t.constraints.fixedStartMin });
    }
    const shortNights = new Set(schedule.exceptions.sleepShortfalls.map((s) => s.date));
    for (const sl of schedule.blocks.filter((b) => b.kind === 'sleep')) {
      if (!shortNights.has(sl.range.date)) expect(sl.range.endMin - sl.range.startMin).toBeGreaterThanOrEqual(480);
    }

    // עריכה: מזיזים משימה גמישה לשבת
    const flexible = schedule.blocks.find((b) => b.kind === 'task' && b.taskId !== undefined && taskTitles.get(b.taskId) === 'אימון')!;
    await tapBlock(flexible.id);
    await until(() => host!.querySelector('[role="dialog"]'), 'sheet');
    await setValue($('[name="move-date"]'), '2026-06-13');
    await setValue($('[name="move-time"]'), '10:00');
    await click(buttonByText('הזז'));
    await until(async () => (await selectedFromStorage(h, week.id)).schedule.blocks.find((b) => b.id === flexible.id)?.range.date === '2026-06-13', 'moved');

    // יום, סקירה
    await nav('day');
    expect($$('.ui-task-card').length).toBeGreaterThan(0);
    await nav('overview');
    expect($$('.scr-days__row')).toHaveLength(7);

    // ICS
    await nav('week');
    await click(buttonByText('ייצוא ליומן (ICS)'));
    expect(h.downloads.at(-1)?.fileName).toBe('schedule-2026-06-07.ics');

    // גיבוי, מחיקה, שחזור
    await nav('settings');
    await click(buttonByText('ייצוא גיבוי'));
    const backup = h.downloads.at(-1)!.text;
    const snapshot = { weeks: await h.storage.listWeeks(), tasks: await h.storage.listTasks() };
    await click(buttonByText('מחק את כל הנתונים'));
    await until(async () => (await h.storage.listWeeks()).length === 0, 'wiped');
    const input = $('[name="backup-file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([backup], 'b.json')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => host!.textContent?.includes('הנתונים שוחזרו'), 'restored');
    expect((await h.storage.listWeeks())).toEqual(snapshot.weeks);
    expect((await h.storage.listTasks())).toEqual(snapshot.tasks);

    // סגירה ופתיחה מחדש: הכול נשמר
    await unmountApp();
    await mountApp(h);
    await nav('week');
    expect($$('.scr-col')).toHaveLength(7);
    expect($$('[data-kind="task"]').length).toBeGreaterThan(0);
  });
});
