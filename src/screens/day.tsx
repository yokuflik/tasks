import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { IsoDate, ScheduleBlock } from '../contracts';
import { hebrewDate, instantToWall } from '../time';
import { Button, SleepBand, TaskCard, TravelBand } from '../ui';
import { isDoneSwipe, segmentsForDate, shortDate, travelSegmentsForDate } from './model';
import { DayMarks, ExceptionsList, NeedSchedule, WeekHeader, weekdayName } from './shared';
import type { ScreenProps } from './types';

function SwipeRow({ onDone, children }: { onDone: () => void; children: JSX.Element }): JSX.Element {
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  return (
    <div
      class="scr-swipe"
      onPointerDown={(e: PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e: PointerEvent) => {
        const s = start.current;
        start.current = undefined;
        if (s && isDoneSwipe(e.clientX - s.x, e.clientY - s.y)) onDone();
      }}
      onPointerCancel={() => { start.current = undefined; }}
    >
      {children}
    </div>
  );
}

export function DayScreen(p: ScreenProps): JSX.Element {
  const week = p.week;
  const [picked, setPicked] = useState<IsoDate | undefined>();
  if (!week || !p.selected) {
    return (
      <div class="scr-screen">
        <WeekHeader title="היום" weekStart={p.weekStart} actions={p.actions} />
        <NeedSchedule p={p} />
      </div>
    );
  }
  const days = week.activeDates;
  const date = picked && days.includes(picked) ? picked : days.includes(p.today) ? p.today : (days[0] ?? p.today);
  const idx = days.indexOf(date);
  const segs = segmentsForDate(p.selected.blocks, date);
  const wall = instantToWall(p.services.now(), p.data.settings.timeZone);
  const nowMin = wall.date === date ? wall.min : undefined;
  const nowAt = nowMin === undefined ? -1 : segs.findIndex((s) => s.startMin > nowMin);

  const nowLine = <div class="scr-now" role="separator" aria-label="עכשיו" data-now />;

  const renderBlock = (b: ScheduleBlock, startMin: number, endMin: number) => {
    if (b.kind === 'sleep') {
      return <SleepBand key={`${b.id}-${startMin}`} startMin={startMin} endMin={endMin} locked={b.locked} />;
    }
    const task = p.tasks.find((t) => t.id === b.taskId);
    const cat = p.data.categories.find((c) => c.id === task?.categoryId);
    if (!task || !cat) return null;
    const toggle = () => void p.actions.toggleDone(task.id);
    return (
      <SwipeRow key={`${b.id}-${startMin}`} onDone={toggle}>
        <TaskCard
          title={task.title}
          category={cat}
          durationMin={endMin - startMin}
          effort={task.effort}
          priority={task.priority}
          startMin={startMin}
          endMin={endMin}
          locked={b.locked}
          done={task.status === 'done'}
          {...(cat.fixed ? {} : { onToggleDone: toggle })}
        />
      </SwipeRow>
    );
  };

  const items: (JSX.Element | null)[] = [];
  const travel = travelSegmentsForDate(p.selected.blocks, p.tasks, date);
  const timeline = [
    ...segs.map((s) => ({ startMin: s.startMin, seg: s as (typeof segs)[number] | undefined, travel: undefined as (typeof travel)[number] | undefined })),
    ...travel.map((t) => ({ startMin: t.startMin, seg: undefined, travel: t })),
  ].sort((a, b) => a.startMin - b.startMin);
  timeline.forEach((e, i) => {
    if (e.seg && segs.indexOf(e.seg) === nowAt) items.push(nowLine);
    if (e.seg) items.push(renderBlock(e.seg.block, e.seg.startMin, e.seg.endMin));
    else if (e.travel) items.push(<TravelBand key={`travel-${e.travel.taskId}-${e.travel.startMin}-${i}`} startMin={e.travel.startMin} endMin={e.travel.endMin} />);
  });
  if (nowMin !== undefined && nowAt === -1 && segs.length > 0) items.push(nowLine);

  return (
    <div class="scr-screen">
      <WeekHeader title="היום" weekStart={p.weekStart} actions={p.actions} />
      <div class="scr-daynav">
        <Button variant="ghost" disabled={idx <= 0} onClick={() => setPicked(days[idx - 1])}>היום הקודם</Button>
        <div class="scr-daynav__label" data-testid="day-label" data-date={date}>
          <strong>{weekdayName(date)} {shortDate(date)}</strong>
          <span class="scr-muted">{hebrewDate(date)}</span>
        </div>
        <Button variant="ghost" disabled={idx < 0 || idx >= days.length - 1} onClick={() => setPicked(days[idx + 1])}>היום הבא</Button>
      </div>
      <div class="scr-marks"><DayMarks date={date} /></div>
      <div class="scr-timeline" data-timeline>
        {items.length > 0 ? items : <p class="scr-muted">אין משימות ביום הזה.</p>}
      </div>
      <ExceptionsList report={p.selected.exceptions} tasks={p.tasks} />
    </div>
  );
}
