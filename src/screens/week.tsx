import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Id, IsoDate, Minutes, ScheduleBlock } from '../contracts';
import { hebrewDate, specialDaysOn, weekDates } from '../time';
import {
  Button, DayLoadBar, Icon, ShabbatColumn, SleepBand, TimeBlock, TravelBand, formatTime,
} from '../ui';
import {
  DAY_MIN,
  blockMinutes,
  classifyPress,
  dayAvailableMin,
  dayLoadMin,
  dropTarget,
  isBlockMovable,
  parseTimeInput,
  segmentsForDate,
  shortDate,
  timeInputValue,
  travelSegmentsForDate,
  type ColumnRect,
} from './model';
import { ExceptionsList, NeedSchedule, WeekHeader, weekdayName } from './shared';
import type { ScreenProps } from './types';

/** פיקסלים לדקה בגריד השבוע. */
export const PX_PER_MIN = 0.5;

interface DragState {
  blockId: Id;
  date: IsoDate;
  startMin: Minutes;
}

interface Press {
  blockId: Id;
  x: number;
  y: number;
  t: number;
  grabOffsetMin: Minutes;
  columns: ColumnRect[];
  gridTop: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  longHandled: boolean;
  dragging: boolean;
}

function BlockSheet({
  block, p, onClose, notice,
}: { block: ScheduleBlock; p: ScreenProps; onClose: () => void; notice: string | undefined }): JSX.Element {
  const task = block.taskId ? p.tasks.find((t) => t.id === block.taskId) : undefined;
  const cat = task ? p.data.categories.find((c) => c.id === task.categoryId) : undefined;
  const [date, setDate] = useState(block.range.date);
  const [time, setTime] = useState(timeInputValue(block.range.startMin));
  const [msg, setMsg] = useState<string | undefined>(notice);
  const movable = isBlockMovable(block, { tasks: p.tasks, categories: p.data.categories });
  const fixed = block.kind === 'task' && !movable && !block.locked;
  const title = block.kind === 'sleep' ? 'שינה' : (task?.title ?? 'משימה');

  const save = async () => {
    const m = parseTimeInput(time);
    if (m === undefined) return setMsg('שעה לא תקינה');
    const err = await p.actions.moveBlock(block.id, date, m);
    if (err) setMsg(err);
    else onClose();
  };

  return (
    <div class="scr-sheet" role="dialog" aria-modal="true" aria-label={`פרטי ${title}`} data-sheet={block.id}>
      <div class="scr-sheet__panel">
        <h2 class="scr-h2">{title}{cat ? ` · ${cat.name}` : ''}</h2>
        <p class="scr-muted">{formatTime(block.range.startMin)}–{formatTime(block.range.endMin)} · {blockMinutes(block)} דקות</p>
        {fixed && <p class="scr-muted"><Icon name="lock" size={14} /> משימה קבועה: אי אפשר להזיז</p>}
        {movable && (
          <div class="scr-form-row">
            <label>יום
              <select name="move-date" value={date} onChange={(e) => setDate((e.currentTarget as HTMLSelectElement).value)}>
                {p.week!.activeDates.map((d) => <option key={d} value={d}>{weekdayName(d)} {shortDate(d)}</option>)}
              </select>
            </label>
            <label>שעה
              <input name="move-time" type="time" step={900} value={time} onInput={(e) => setTime((e.currentTarget as HTMLInputElement).value)} />
            </label>
          </div>
        )}
        {msg && <p class="scr-error" role="alert">{msg}</p>}
        <div class="scr-actions">
          {movable && <Button onClick={() => void save()}>הזז</Button>}
          {(movable || block.locked || block.kind === 'sleep') && (
            <Button variant="secondary" onClick={() => { void p.actions.setBlockLocked(block.id, !block.locked); onClose(); }}>
              {block.locked ? 'שחרר נעילה' : 'נעל'}
            </Button>
          )}
          {task && block.kind === 'task' && (
            <Button variant="secondary" onClick={() => { void p.actions.toggleDone(task.id); onClose(); }}>
              {task.status === 'done' ? 'בטל סימון בוצע' : 'סמן כבוצע'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>סגור</Button>
        </div>
      </div>
    </div>
  );
}

export function WeekScreen(p: ScreenProps): JSX.Element {
  const [drag, setDrag] = useState<DragState | undefined>();
  const [open, setOpen] = useState<Id | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const press = useRef<Press | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);

  if (!p.week || !p.selected) {
    return (
      <div class="scr-screen">
        <WeekHeader title="שבוע" weekStart={p.weekStart} actions={p.actions} />
        <NeedSchedule p={p} />
      </div>
    );
  }
  const week = p.week;
  const schedule = p.selected;
  const dates = weekDates(week.startDate);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const editCtx = { tasks: p.tasks, categories: p.data.categories };

  const pointerDown = (e: PointerEvent, block: ScheduleBlock) => {
    const el = e.currentTarget as HTMLElement;
    const grid = gridRef.current;
    if (!grid) return;
    const bodies = [...grid.querySelectorAll<HTMLElement>('[data-col-body]')];
    const columns = bodies.map((b) => {
      const r = b.getBoundingClientRect();
      return { date: b.dataset['colBody']!, left: r.left, right: r.right };
    });
    const top = bodies[0]?.getBoundingClientRect().top ?? 0;
    const rect = el.getBoundingClientRect();
    try { el.setPointerCapture?.(e.pointerId); } catch { /* לא נתמך */ }
    const cur: Press = {
      blockId: block.id, x: e.clientX, y: e.clientY, t: Date.now(),
      grabOffsetMin: (e.clientY - rect.top) / PX_PER_MIN, columns, gridTop: top,
      timer: undefined, longHandled: false, dragging: false,
    };
    cur.timer = setTimeout(() => {
      const c = press.current;
      if (c && c.blockId === block.id && !c.dragging) {
        c.longHandled = true;
        if (block.kind === 'sleep' || isBlockMovable(block, editCtx) || block.locked) void p.actions.setBlockLocked(block.id, !block.locked);
      }
    }, 450);
    press.current = cur;
  };

  const pointerMove = (e: PointerEvent) => {
    const c = press.current;
    if (!c) return;
    const block = schedule.blocks.find((b) => b.id === c.blockId);
    if (!block || !isBlockMovable(block, editCtx)) return;
    const moved = Math.hypot(e.clientX - c.x, e.clientY - c.y);
    if (classifyPress(moved, Date.now() - c.t) !== 'drag' && !c.dragging) return;
    c.dragging = true;
    if (c.timer) clearTimeout(c.timer);
    const t = dropTarget(e.clientX, e.clientY, c.columns, c.gridTop, PX_PER_MIN, c.grabOffsetMin);
    if (t) setDrag({ blockId: c.blockId, date: t.date, startMin: t.startMin });
  };

  const pointerUp = async () => {
    const c = press.current;
    press.current = undefined;
    if (!c) return;
    if (c.timer) clearTimeout(c.timer);
    if (c.dragging) {
      const d = drag;
      setDrag(undefined);
      if (d) {
        const err = await p.actions.moveBlock(d.blockId, d.date, d.startMin);
        setNotice(err);
      }
    } else if (!c.longHandled) {
      setNotice(undefined);
      setOpen(c.blockId);
    }
  };

  const pointerCancel = () => {
    const c = press.current;
    if (c?.timer) clearTimeout(c.timer);
    press.current = undefined;
    setDrag(undefined);
  };

  const renderSegment = (seg: ReturnType<typeof segmentsForDate>[number]) => {
    const b = seg.block;
    const dragging = drag?.blockId === b.id;
    const style = { position: 'absolute', insetBlockStart: `${seg.startMin * PX_PER_MIN}px`, blockSize: `${Math.max(14, (seg.endMin - seg.startMin) * PX_PER_MIN)}px`, insetInline: '2px' };
    const handlers = {
      onPointerDown: (e: PointerEvent) => pointerDown(e, b),
      onPointerMove: pointerMove,
      onPointerUp: () => void pointerUp(),
      onPointerCancel: pointerCancel,
    };
    if (b.kind === 'sleep') {
      return (
        <div key={`${b.id}-${seg.continuation ? 'c' : 's'}`} class="scr-block" style={style} data-block={b.id} data-kind="sleep" {...handlers}>
          <SleepBand startMin={b.range.startMin} endMin={b.range.endMin} locked={b.locked} />
        </div>
      );
    }
    const task = p.tasks.find((t) => t.id === b.taskId);
    const cat = p.data.categories.find((c) => c.id === task?.categoryId);
    if (!task || !cat) return null;
    const warn = p.data.settings.warnOnSpecialDays && !cat.fixed && specialDaysOn(b.range.date).length > 0;
    return (
      <div key={`${b.id}-${seg.continuation ? 'c' : 's'}`} class={`scr-block${task.status === 'done' ? ' is-done' : ''}${dragging ? ' is-dragging' : ''}`} style={style}
        data-block={b.id} data-kind="task" {...handlers}>
        <TimeBlock title={task.title} category={cat} startMin={b.range.startMin} endMin={b.range.endMin} locked={b.locked} compact={b.range.endMin - b.range.startMin <= 60} />
        {warn && <span class="scr-warn" title="יום מיוחד"><Icon name="warning" size={12} /></span>}
      </div>
    );
  };

  const column = (date: IsoDate) => {
    const segs = segmentsForDate(schedule.blocks, date);
    const ghostBlock = drag && drag.date === date ? schedule.blocks.find((b) => b.id === drag.blockId) : undefined;
    const body = (
      <div class="scr-col__body" data-col-body={date} style={{ blockSize: `${DAY_MIN * PX_PER_MIN}px` }}>
        {travelSegmentsForDate(schedule.blocks, p.tasks, date).map((t, i) => (
          <div key={`travel-${t.taskId}-${t.startMin}-${i}`} class="scr-block" data-kind="travel"
            style={{ position: 'absolute', insetBlockStart: `${t.startMin * PX_PER_MIN}px`, blockSize: `${(t.endMin - t.startMin) * PX_PER_MIN}px`, insetInline: '2px', pointerEvents: 'none' }}>
            <TravelBand startMin={t.startMin} endMin={t.endMin} compact />
          </div>
        ))}
        {segs.map(renderSegment)}
        {ghostBlock && drag && (
          <div class="scr-block is-ghost" data-ghost style={{ position: 'absolute', insetBlockStart: `${drag.startMin * PX_PER_MIN}px`, blockSize: `${blockMinutes(ghostBlock) * PX_PER_MIN}px`, insetInline: '2px' }} />
        )}
      </div>
    );
    const marks = specialDaysOn(date);
    const shabbat = marks.find((m) => m.kind === 'shabbat');
    const available = dayAvailableMin(week, schedule.blocks, date);
    const header = (
      <>
        <strong>{weekdayName(date)}</strong>
        <span class="scr-col__date">{shortDate(date)}</span>
        <DayLoadBar loadMin={dayLoadMin(schedule.blocks, date)} availableMin={available} />
      </>
    );
    if (shabbat) {
      return (
        <div class="scr-col is-shabbat" key={date} data-date={date}>
          <ShabbatColumn day={shabbat} dateLabel={shortDate(date)}>
            <DayLoadBar loadMin={dayLoadMin(schedule.blocks, date)} availableMin={available} />
            {body}
          </ShabbatColumn>
        </div>
      );
    }
    const holiday = marks.find((m) => m.kind !== 'shabbat');
    return (
      <div class={`scr-col${holiday ? ` is-${holiday.kind}` : ''}`} key={date} data-date={date} data-special={holiday?.kind}>
        <header class="scr-col__head">
          {header}
          <span class="scr-col__heb">{hebrewDate(date)}</span>
          {holiday && <span class="scr-col__tag" data-kind={holiday.kind}>{holiday.name}</span>}
        </header>
        {body}
      </div>
    );
  };

  const openBlock = open ? schedule.blocks.find((b) => b.id === open) : undefined;

  return (
    <div class="scr-screen scr-screen--wide">
      <WeekHeader title="שבוע" weekStart={p.weekStart} actions={p.actions} />
      <div class="scr-actions">
        <Button variant="secondary" onClick={() => p.actions.goto('compare')}>החלפת סידור</Button>
        <Button variant="secondary" onClick={() => p.actions.exportIcs()}>ייצוא ליומן (ICS)</Button>
      </div>
      {notice && <p class="scr-error" role="alert">{notice}</p>}
      <p class="scr-muted">גרור בלוק להזזה, לחיצה ארוכה לנעילה, נגיעה לפרטים.</p>
      <div class="scr-grid" ref={gridRef} data-grid>
        <div class="scr-gutter" aria-hidden="true">
          <div class="scr-col__headspace" />
          <div class="scr-gutter__body" style={{ blockSize: `${DAY_MIN * PX_PER_MIN}px` }}>
            {hours.map((h) => <span key={h} style={{ position: 'absolute', insetBlockStart: `${h * 60 * PX_PER_MIN}px` }}>{String(h).padStart(2, '0')}</span>)}
          </div>
        </div>
        {dates.map(column)}
      </div>
      <ExceptionsList report={schedule.exceptions} tasks={p.tasks} />
      {openBlock && <BlockSheet key={openBlock.id} block={openBlock} p={p} notice={notice} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

