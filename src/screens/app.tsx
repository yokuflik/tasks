import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Category, Id, IsoDate, Minutes, Settings } from '../contracts';
import { backupFileName } from '../storage';
import type { PersistResult } from '../storage';
import { exportScheduleToIcs, importIcsAsBlockedTimes } from '../ics';
import { addDays, weekDates, weekStartOf } from '../time';
import { AppFrame, Button, Icon } from '../ui';
import { DayScreen } from './day';
import { EntryScreen } from './entry';
import { CompareScreen } from './compare';
import {
  copyTasksToNextWeek,
  createShift,
  createTask,
  createWeek,
  lockedBlocksOf,
  moveBlock,
  newId,
  replaceSchedule,
  selectedSchedule,
  setBlockLocked,
  type ShiftInput,
  type TaskForm,
} from './model';
import { OverviewScreen } from './overview';
import type { AppServices } from './services';
import { SettingsScreen } from './settings';
import type { Actions, AppData, BlockedInput, ScreenProps, TabId } from './types';
import { OWNER_NAME } from './shared';
import { WeekScreen } from './week';

const TAB_KEY = 'planner.tab';

function readTab(): TabId | undefined {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'day' || v === 'week' || v === 'overview' || v === 'entry' || v === 'settings' ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeTab(tab: TabId): void {
  try {
    if (tab !== 'compare') localStorage.setItem(TAB_KEY, tab);
  } catch {
    // אחסון מקומי לא זמין: לא קריטי
  }
}

const NAV: { id: TabId; label: string; icon: string }[] = [
  { id: 'day', label: 'יום', icon: 'check' },
  { id: 'week', label: 'שבוע', icon: 'grip' },
  { id: 'overview', label: 'סקירה', icon: 'palette' },
  { id: 'entry', label: 'הזנה', icon: 'book' },
  { id: 'settings', label: 'הגדרות', icon: 'home' },
];

export function App({ services }: { services: AppServices }) {
  const [data, setData] = useState<AppData | undefined>();
  const [weekStart, setWeekStartState] = useState<IsoDate | undefined>();
  const [tab, setTab] = useState<TabId>('entry');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [persist, setPersist] = useState<PersistResult | undefined>();
  const initialised = useRef(false);
  const dataRef = useRef<AppData | undefined>(undefined);
  const weekStartRef = useRef<IsoDate | undefined>(undefined);
  dataRef.current = data;
  weekStartRef.current = weekStart;

  const load = useCallback(async (): Promise<AppData> => {
    const st = services.storage;
    const [settings, categories, tasks, weeks] = await Promise.all([
      st.getSettings(), st.listCategories(), st.listTasks(), st.listWeeks(),
    ]);
    const next: AppData = { settings, categories, tasks, weeks };
    dataRef.current = next;
    setData(next);
    return next;
  }, [services]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await load();
        if (!alive || initialised.current) return;
        initialised.current = true;
        const start = weekStartOf(services.today(d.settings.timeZone));
        setWeekStartState(start);
        const w = d.weeks.find((x) => x.startDate === start);
        const hasSelected = w && selectedSchedule(w) !== undefined;
        setTab(hasSelected ? (readTab() ?? 'day') : 'entry');
        setPersist(await services.requestPersistence());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה בטעינת הנתונים');
      }
    })();
    return () => { alive = false; };
  }, [services, load]);

  const currentWeek = () => {
    const d = dataRef.current;
    const s = weekStartRef.current;
    return d && s ? d.weeks.find((w) => w.startDate === s) : undefined;
  };
  const weekTasks = (d: AppData, weekId: Id) => d.tasks.filter((t) => t.weekId === weekId);

  const actions: Actions = useMemo(() => {
    /** מריץ פעולה, מטפל בשגיאה וטוען מחדש. */
    const run = async <T,>(fn: () => Promise<T>, reload = true): Promise<T | undefined> => {
      try {
        setError(undefined);
        const out = await fn();
        if (reload) await load();
        return out;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'הפעולה נכשלה');
        return undefined;
      }
    };
    const st = services.storage;
    const requireWeek = () => {
      const w = currentWeek();
      if (!w) throw new Error('אין שבוע. צור שבוע קודם');
      return w;
    };

    const a: Actions = {
      goto(t) { setTab(t); writeTab(t); },
      setWeekStart(date) { setWeekStartState(weekStartOf(date)); },
      createWeek: () => run(async () => {
        const start = weekStartRef.current!;
        if (!currentWeek()) await st.saveWeek(createWeek(start));
      }).then(() => undefined),
      copyFromPreviousWeek: () => run(async () => {
        const w = requireWeek();
        const prev = dataRef.current!.weeks.find((x) => x.startDate === addDays(w.startDate, -7));
        if (!prev) throw new Error('אין שבוע קודם להעתקה');
        const copies = copyTasksToNextWeek(weekTasks(dataRef.current!, prev.id), w.id, 7);
        await st.saveTasks(copies);
        await st.saveWeek({ ...w, taskIds: [...w.taskIds, ...copies.map((t) => t.id)] });
      }).then(() => undefined),
      toggleActiveDate: (date) => run(async () => {
        const w = requireWeek();
        const on = w.activeDates.includes(date);
        const dates = weekDates(w.startDate).filter((d) => (d === date ? !on : w.activeDates.includes(d)));
        await st.saveWeek({ ...w, activeDates: dates });
      }).then(() => undefined),
      addShift: (input: ShiftInput) => run(async () => {
        const w = requireWeek();
        const shift = createShift(w.id, input);
        await st.saveTask(shift);
        await st.saveWeek({ ...w, taskIds: [...w.taskIds, shift.id] });
      }).then(() => undefined),
      addTask: (form: TaskForm) => run(async () => {
        const w = requireWeek();
        const task = createTask(w.id, form);
        await st.saveTask(task);
        await st.saveWeek({ ...w, taskIds: [...w.taskIds, task.id] });
      }).then(() => undefined),
      removeTask: (id) => run(() => st.deleteTask(id)).then(() => undefined),
      addBlocked: (input: BlockedInput) => run(async () => {
        const w = requireWeek();
        const end = input.endMin > input.startMin ? input.endMin : input.endMin + 1440;
        await st.saveWeek({
          ...w,
          blockedTimes: [...w.blockedTimes, {
            id: newId('blocked'),
            title: input.title.trim() || 'זמן חסום',
            range: { date: input.date, startMin: input.startMin, endMin: end },
            source: 'manual',
          }],
        });
      }).then(() => undefined),
      removeBlocked: (id) => run(async () => {
        const w = requireWeek();
        await st.saveWeek({ ...w, blockedTimes: w.blockedTimes.filter((b) => b.id !== id) });
      }).then(() => undefined),
      importIcs: async (text) => {
        const n = await run(async () => {
          const w = requireWeek();
          const found = importIcsAsBlockedTimes(text, {
            timeZone: dataRef.current!.settings.timeZone,
            range: { start: w.startDate, end: addDays(w.startDate, 6) },
          });
          const known = new Set(w.blockedTimes.map((b) => b.id));
          const fresh = found.filter((b) => !known.has(b.id));
          await st.saveWeek({ ...w, blockedTimes: [...w.blockedTimes, ...fresh] });
          return fresh.length;
        });
        return n ?? 0;
      },
      generate: async () => {
        setBusy(true);
        try {
          const ok = await run(async () => {
            const w = requireWeek();
            const d = dataRef.current!;
            const prevSeed = w.schedules[0]?.seed;
            const set = await services.generate({
              week: w,
              tasks: weekTasks(d, w.id),
              categories: d.categories,
              settings: d.settings,
              lockedBlocks: lockedBlocksOf(selectedSchedule(w)),
              ...(prevSeed !== undefined ? { seed: prevSeed + 1 } : {}),
            });
            await st.saveWeek({ ...w, schedules: set.schedules });
            return true;
          });
          if (ok) setTab('compare');
        } finally {
          setBusy(false);
        }
      },
      selectSchedule: (id) => run(async () => {
        const w = requireWeek();
        await st.saveWeek({ ...w, selectedScheduleId: id });
        setTab('week');
        writeTab('week');
      }).then(() => undefined),
      moveBlock: async (blockId, date, startMin: Minutes) => {
        const w = currentWeek();
        const sel = selectedSchedule(w);
        if (!w || !sel) return 'אין סידור נבחר';
        const d = dataRef.current!;
        const result = moveBlock(sel, blockId, date, startMin, {
          week: w, tasks: weekTasks(d, w.id), categories: d.categories, settings: d.settings,
        });
        if (!result.ok) return result.reason;
        await run(() => st.saveWeek(replaceSchedule(w, result.schedule)));
        return undefined;
      },
      setBlockLocked: (blockId, locked) => run(async () => {
        const w = requireWeek();
        const sel = selectedSchedule(w);
        if (sel) await st.saveWeek(replaceSchedule(w, setBlockLocked(sel, blockId, locked)));
      }).then(() => undefined),
      toggleDone: (taskId) => run(async () => {
        const t = dataRef.current!.tasks.find((x) => x.id === taskId);
        if (t) await st.saveTask({ ...t, status: t.status === 'done' ? 'scheduled' : 'done' });
      }).then(() => undefined),
      exportIcs() {
        const w = currentWeek();
        const sel = selectedSchedule(w);
        const d = dataRef.current;
        if (!w || !sel || !d) return;
        const text = exportScheduleToIcs(sel, weekTasks(d, w.id), d.categories, d.settings, { now: services.now() });
        services.download(`schedule-${w.startDate}.ics`, text, 'text/calendar');
      },
      saveSettings: (settings: Settings) => run(() => st.saveSettings(settings)).then(() => undefined),
      saveCategory: (category: Category) => run(() => st.saveCategory(category)).then(() => undefined),
      exportBackup: () => run(async () => {
        const { text } = await st.exportBackup();
        services.download(backupFileName(services.now()), text, 'application/json');
      }).then(() => undefined),
      importBackup: async (text) => {
        try {
          await st.importBackup(text);
          await load();
          return undefined;
        } catch (e) {
          return e instanceof Error ? e.message : 'קובץ הגיבוי אינו תקין';
        }
      },
      resetAll: () => run(() => st.resetAll()).then(() => undefined),
    };
    return a;
  }, [services, load]);

  if (!data || !weekStart) {
    return (
      <AppFrame>
        <main class="scr-main" aria-busy="true">
          {error ? <p class="scr-error" role="alert">{error}</p> : <p class="scr-muted">טוען…</p>}
        </main>
      </AppFrame>
    );
  }

  const week = data.weeks.find((w) => w.startDate === weekStart);
  const props: ScreenProps = {
    data,
    weekStart,
    week,
    tasks: week ? weekTasks(data, week.id) : [],
    selected: selectedSchedule(week),
    today: services.today(data.settings.timeZone),
    busy,
    persist,
    actions,
    services,
  };

  const screen = (() => {
    switch (tab) {
      case 'day': return <DayScreen {...props} />;
      case 'week': return <WeekScreen {...props} />;
      case 'overview': return <OverviewScreen {...props} />;
      case 'entry': return <EntryScreen {...props} />;
      case 'compare': return <CompareScreen {...props} />;
      case 'settings': return <SettingsScreen {...props} />;
    }
  })();

  return (
    <AppFrame>
      {error && (
        <div class="scr-error" role="alert">
          <span>{error}</span>
          <Button variant="ghost" onClick={() => setError(undefined)}>סגור</Button>
        </div>
      )}
      <div class="scr-brand">
        <span class="scr-brand__name">האפליקציה של {OWNER_NAME} <span aria-hidden="true">🌸</span></span>
        <span class="scr-brand__hello">ברוכה הבאה, {OWNER_NAME}</span>
      </div>
      <main class="scr-main" data-screen={tab}>{screen}</main>
      <nav class="scr-nav" aria-label="ניווט ראשי">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            class={tab === n.id ? 'scr-nav__item is-active' : 'scr-nav__item'}
            aria-current={tab === n.id ? 'page' : undefined}
            data-nav={n.id}
            onClick={() => actions.goto(n.id)}
          >
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </AppFrame>
  );
}
