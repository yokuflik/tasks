import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Flexibility } from '../contracts';
import { weekDates } from '../time';
import { Button, Card, Icon, formatDuration, formatRange } from '../ui';
import {
  isShift,
  parseTimeInput,
  shortDate,
  validateTaskForm,
  type TaskForm,
} from './model';
import { Empty, WeekHeader, weekdayName } from './shared';
import type { ScreenProps } from './types';

const TRAVELS = [0, 10, 15, 20, 30, 45, 60];
const FLEX: [Flexibility, string][] = [['flexible', 'גמישה'], ['semi', 'חצי גמישה'], ['fixed', 'קבועה']];

/** משמרות קבועות מוכנות: בחירה ממלאת שעות, בלי להזין כל פעם מחדש. */
const SHIFT_PRESETS: { id: string; label: string; start: string; end: string }[] = [
  { id: 'm15', label: 'בוקר 06:45–15:00', start: '06:45', end: '15:00' },
  { id: 'm17', label: 'בוקר 06:45–17:00', start: '06:45', end: '17:00' },
  { id: 'm19', label: 'בוקר 06:45–19:00', start: '06:45', end: '19:00' },
  { id: 'noon', label: 'צהריים 14:45–23:00', start: '14:45', end: '23:00' },
  { id: 'n18', label: 'לילה 18:45–07:00', start: '18:45', end: '07:00' },
  { id: 'n22', label: 'לילה 22:45–07:00', start: '22:45', end: '07:00' },
];

function ShiftsSection({ p }: { p: ScreenProps }): JSX.Element {
  const week = p.week!;
  const dates = weekDates(week.startDate);
  const [date, setDate] = useState(week.activeDates[0] ?? dates[0]!);
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('15:00');
  const [preset, setPreset] = useState<string>('m15');
  const [error, setError] = useState<string | undefined>();
  const choose = (id: string) => {
    setPreset(id);
    const found = SHIFT_PRESETS.find((x) => x.id === id);
    if (found) { setStart(found.start); setEnd(found.end); }
  };
  const shifts = p.tasks.filter(isShift).sort((a, b) =>
    `${a.constraints.fixedDate}${String(a.constraints.fixedStartMin).padStart(4, '0')}`.localeCompare(
      `${b.constraints.fixedDate}${String(b.constraints.fixedStartMin).padStart(4, '0')}`));

  const add = () => {
    const s = parseTimeInput(start);
    const e = parseTimeInput(end);
    if (s === undefined || e === undefined) return setError('שעה לא תקינה');
    if (s === e) return setError('שעת הסיום זהה להתחלה');
    setError(undefined);
    void p.actions.addShift({ date, startMin: s, endMin: e });
    const next = dates[dates.indexOf(date) + 1];
    if (next) setDate(next);
  };

  return (
    <Card>
      <h2 class="scr-h2">1. משמרות עבודה</h2>
      <p class="scr-muted">מזינים קודם. המערכת קובעת שינה ומשבצת את כל השאר סביב המשמרות.</p>
      <ul class="scr-list" aria-label="משמרות השבוע">
        {shifts.map((t) => (
          <li key={t.id} data-shift={t.id}>
            <span>
              <Icon name="lock" size={16} /> {weekdayName(t.constraints.fixedDate!)} {shortDate(t.constraints.fixedDate!)} ·{' '}
              {formatRange(t.constraints.fixedStartMin!, t.constraints.fixedStartMin! + t.durationMin)}
            </span>
            <button type="button" class="scr-iconbtn" aria-label={`מחק משמרת ${t.constraints.fixedDate}`} onClick={() => void p.actions.removeTask(t.id)}>✕</button>
          </li>
        ))}
        {shifts.length === 0 && <li class="scr-muted">עוד לא הוזנו משמרות</li>}
      </ul>
      <div class="scr-chips" role="group" aria-label="משמרת קבועה">
        {SHIFT_PRESETS.map((x) => (
          <button key={x.id} type="button" class={preset === x.id ? 'scr-chip is-on' : 'scr-chip'} aria-pressed={preset === x.id} onClick={() => choose(x.id)}>{x.label}</button>
        ))}
        <button type="button" class={preset === 'manual' ? 'scr-chip is-on' : 'scr-chip'} aria-pressed={preset === 'manual'} onClick={() => setPreset('manual')}>ידנית</button>
      </div>
      <div class="scr-form-row">
        <label>יום
          <select name="shift-date" value={date} onChange={(e) => setDate((e.currentTarget as HTMLSelectElement).value)}>
            {dates.map((d) => <option key={d} value={d}>{weekdayName(d)} {shortDate(d)}</option>)}
          </select>
        </label>
        <label>התחלה
          <input name="shift-start" type="time" value={start} disabled={preset !== 'manual'} onInput={(e) => setStart((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>סיום
          <input name="shift-end" type="time" value={end} disabled={preset !== 'manual'} onInput={(e) => setEnd((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      {error && <p class="scr-error" role="alert">{error}</p>}
      <Button variant="secondary" onClick={add}>הוסף משמרת</Button>
    </Card>
  );
}

const BLANK: TaskForm = {
  title: '', categoryId: 'study', durationMin: 60, travelMin: 0,
  flexibility: 'flexible', timesPerWeek: 1, splittable: false, dependsOn: [],
};

function TasksSection({ p }: { p: ScreenProps }): JSX.Element {
  const [form, setForm] = useState<TaskForm>({ ...BLANK, categoryId: p.data.categories.find((c) => !c.fixed)?.id ?? BLANK.categoryId });
  const [more, setMore] = useState(false);
  const [fixedStart, setFixedStart] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const set = (patch: Partial<TaskForm>) => setForm((f) => ({ ...f, ...patch }));
  const flexibleTasks = p.tasks.filter((t) => !isShift(t));
  const complete = (): TaskForm => {
    const full: TaskForm = { ...form };
    delete full.fixedStartMin;
    const fs = fixedStart ? parseTimeInput(fixedStart) : undefined;
    if (fs !== undefined) full.fixedStartMin = fs;
    return full;
  };
  const errors = submitted ? validateTaskForm(complete()) : {};

  const submit = (ev: Event) => {
    ev.preventDefault();
    const full = complete();
    setSubmitted(true);
    if (Object.keys(validateTaskForm(full)).length > 0) return;
    void p.actions.addTask(full).then(() => {
      setForm((f) => ({ ...BLANK, categoryId: f.categoryId }));
      setFixedStart('');
      setSubmitted(false);
    });
  };

  return (
    <Card>
      <h2 class="scr-h2">2. משימות</h2>
      <ul class="scr-list" aria-label="משימות השבוע">
        {flexibleTasks.map((t) => {
          const cat = p.data.categories.find((c) => c.id === t.categoryId);
          return (
            <li key={t.id} data-task={t.id}>
              <span>{t.title} · {cat?.name ?? ''} · {formatDuration(t.durationMin)}{t.timesPerWeek > 1 ? ` · ${t.timesPerWeek} פעמים` : ''}</span>
              <button type="button" class="scr-iconbtn" aria-label={`מחק ${t.title}`} onClick={() => void p.actions.removeTask(t.id)}>✕</button>
            </li>
          );
        })}
        {flexibleTasks.length === 0 && <li class="scr-muted">עוד לא הוזנו משימות</li>}
      </ul>
      <form class="scr-form" onSubmit={submit} noValidate>
        <label>כותרת
          <input name="title" value={form.title} onInput={(e) => set({ title: (e.currentTarget as HTMLInputElement).value })} aria-invalid={errors.title ? 'true' : undefined} />
        </label>
        {errors.title && <p class="scr-error" role="alert">{errors.title}</p>}
        <div class="scr-form-row">
          <label>קטגוריה
            <select name="category" value={form.categoryId} onChange={(e) => set({ categoryId: (e.currentTarget as HTMLSelectElement).value })}>
              {p.data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>משך בדקות
            <input name="duration" type="number" inputMode="numeric" min={15} step={15} value={form.durationMin}
              onInput={(e) => set({ durationMin: Number((e.currentTarget as HTMLInputElement).value) })} />
          </label>
        </div>
        {errors.duration && <p class="scr-error" role="alert">{errors.duration}</p>}
        <div class="scr-form-row">
          <label>נסיעה (דקות, לכל כיוון)
            <select name="travel" value={form.travelMin} onChange={(e) => set({ travelMin: Number((e.currentTarget as HTMLSelectElement).value) })}>
              {TRAVELS.map((v) => <option key={v} value={v}>{v === 0 ? 'ללא' : v}</option>)}
            </select>
          </label>
          <label>פעמים בשבוע
            <input name="times" type="number" inputMode="numeric" min={1} max={14} value={form.timesPerWeek}
              onInput={(e) => set({ timesPerWeek: Number((e.currentTarget as HTMLInputElement).value) || 1 })} />
          </label>
        </div>
        <button type="button" class="scr-link" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'פחות אפשרויות' : 'עוד אפשרויות'}</button>
        {more && (
          <div class="scr-more">
            <div class="scr-form-row">
              <label>גמישות
                <select name="flexibility" value={form.flexibility} onChange={(e) => set({ flexibility: (e.currentTarget as HTMLSelectElement).value as Flexibility })}>
                  {FLEX.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>תאריך יעד
                <select name="due" value={form.dueDate ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; const n = { ...form }; if (v) n.dueDate = v; else delete n.dueDate; setForm(n); }}>
                  <option value="">ללא</option>
                  {weekDates(p.weekStart).map((d) => <option key={d} value={d}>{weekdayName(d)} {shortDate(d)}</option>)}
                </select>
              </label>
            </div>
            <div class="scr-form-row">
              <label>יום קבוע
                <select name="fixed-date" value={form.fixedDate ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; const n = { ...form }; if (v) n.fixedDate = v; else delete n.fixedDate; setForm(n); }}>
                  <option value="">ללא</option>
                  {weekDates(p.weekStart).map((d) => <option key={d} value={d}>{weekdayName(d)} {shortDate(d)}</option>)}
                </select>
              </label>
              <label>שעה קבועה
                <input name="fixed-start" type="time" value={fixedStart} onInput={(e) => setFixedStart((e.currentTarget as HTMLInputElement).value)} />
              </label>
            </div>
            {errors.fixed && <p class="scr-error" role="alert">{errors.fixed}</p>}
            <label class="scr-check">
              <input name="splittable" type="checkbox" checked={form.splittable} onChange={(e) => set({ splittable: (e.currentTarget as HTMLInputElement).checked })} />
              אפשר לפצל למקטעים
            </label>
            {flexibleTasks.length > 0 && (
              <label>חייבת לבוא אחרי
                <select name="depends" value={form.dependsOn[0] ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; set({ dependsOn: v ? [v] : [] }); }}>
                  <option value="">ללא</option>
                  {flexibleTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        <Button type="submit">הוסף משימה</Button>
      </form>
    </Card>
  );
}

function BlockedSection({ p }: { p: ScreenProps }): JSX.Element {
  const week = p.week!;
  const dates = weekDates(week.startDate);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dates[0]!);
  const [start, setStart] = useState('12:00');
  const [endDate, setEndDate] = useState(dates[0]!);
  const [end, setEnd] = useState('13:00');
  const [note, setNote] = useState<string | undefined>();

  const add = () => {
    const s = parseTimeInput(start);
    const e = parseTimeInput(end);
    if (s === undefined || e === undefined) return setNote('שעות לא תקינות');
    if (endDate < date || (endDate === date && e <= s)) return setNote('הסיום חייב להיות אחרי ההתחלה');
    setNote(undefined);
    // טווח שחוצה ימים נשמר כפלח לכל יום
    for (const d of dates.filter((x) => x >= date && x <= endDate)) {
      void p.actions.addBlocked({
        title, date: d,
        startMin: d === date ? s : 0,
        endMin: d === endDate ? e : 1440,
      });
    }
    setTitle('');
  };
  const onFile = async (ev: Event) => {
    const file = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const n = await p.actions.importIcs(await readText(file));
      setNote(`יובאו ${n} זמנים חסומים`);
    } catch {
      setNote('קובץ ICS לא תקין');
    }
  };

  return (
    <Card>
      <h2 class="scr-h2">3. זמנים חסומים</h2>
      <ul class="scr-list" aria-label="זמנים חסומים">
        {week.blockedTimes.map((b) => (
          <li key={b.id} data-blocked={b.id}>
            <span>{b.title} · {weekdayName(b.range.date)} {shortDate(b.range.date)} · {formatRange(b.range.startMin, b.range.endMin)}</span>
            <button type="button" class="scr-iconbtn" aria-label={`מחק ${b.title}`} onClick={() => void p.actions.removeBlocked(b.id)}>✕</button>
          </li>
        ))}
        {week.blockedTimes.length === 0 && <li class="scr-muted">אין זמנים חסומים</li>}
      </ul>
      <div class="scr-form-row">
        <label>שם
          <input name="blocked-title" value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="scr-form-row">
        <label>מיום
          <select name="blocked-date" value={date} onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            setDate(v);
            if (endDate < v) setEndDate(v);
          }}>
            {dates.map((d) => <option key={d} value={d}>{weekdayName(d)} {shortDate(d)}</option>)}
          </select>
        </label>
        <label>משעה
          <input name="blocked-start" type="time" value={start} onInput={(e) => setStart((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="scr-form-row">
        <label>עד יום
          <select name="blocked-end-date" value={endDate} onChange={(e) => setEndDate((e.currentTarget as HTMLSelectElement).value)}>
            {dates.filter((d) => d >= date).map((d) => <option key={d} value={d}>{weekdayName(d)} {shortDate(d)}</option>)}
          </select>
        </label>
        <label>עד שעה
          <input name="blocked-end" type="time" value={end} onInput={(e) => setEnd((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="scr-actions">
        <Button variant="secondary" onClick={add}>הוסף זמן חסום</Button>
        <label class="scr-filebtn">ייבוא מקובץ ICS
          <input name="ics-file" type="file" accept=".ics,text/calendar" onChange={(e) => void onFile(e)} />
        </label>
      </div>
      {note && <p class="scr-muted" role="status">{note}</p>}
    </Card>
  );
}

export function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function EntryScreen(p: ScreenProps): JSX.Element {
  const week = p.week;
  if (!week) {
    return (
      <div class="scr-screen">
        <WeekHeader title="הזנת שבוע" weekStart={p.weekStart} actions={p.actions} />
        <Empty text="עדיין אין שבוע בתאריך הזה.">
          <Button onClick={() => void p.actions.createWeek()}>צור שבוע חדש</Button>
        </Empty>
      </div>
    );
  }
  const hasShifts = p.tasks.some(isShift);
  const hasPrev = p.data.weeks.some((w) => w.startDate < week.startDate);
  const generateLabel = week.schedules.length > 0 ? 'הפק מחדש' : 'הפק סידורים';
  return (
    <div class="scr-screen">
      <WeekHeader title="הזנת שבוע" weekStart={p.weekStart} actions={p.actions} />
      <Card>
        <h2 class="scr-h2">ימים פעילים</h2>
        <div class="scr-chips" role="group" aria-label="ימים פעילים">
          {weekDates(week.startDate).map((d) => (
            <button key={d} type="button" class={week.activeDates.includes(d) ? 'scr-chip is-on' : 'scr-chip'} aria-pressed={week.activeDates.includes(d)}
              data-day={d} onClick={() => void p.actions.toggleActiveDate(d)}>{weekdayName(d)}</button>
          ))}
        </div>
        {hasPrev && <Button variant="ghost" onClick={() => void p.actions.copyFromPreviousWeek()}>העתק משימות משבוע קודם</Button>}
      </Card>
      <ShiftsSection p={p} />
      <TasksSection p={p} />
      <BlockedSection p={p} />
      {!hasShifts && <p class="scr-muted" role="note">לא הוזנו משמרות. השיבוץ ייקבע שינה על סמך הזמן הפנוי בלבד.</p>}
      <div class="scr-sticky">
        <Button onClick={() => void p.actions.generate()} disabled={p.busy || week.activeDates.length === 0}>
          {p.busy ? 'מפיק…' : generateLabel}
        </Button>
        {week.schedules.length > 0 && !p.busy && (
          <Button variant="ghost" onClick={() => p.actions.goto('compare')}>לשלושת הסידורים</Button>
        )}
      </div>
    </div>
  );
}
