import type { JSX } from 'preact';
import type { Category, Schedule, Task } from '../contracts';
import { weekDates } from '../time';
import { Badge, Button, Card } from '../ui';
import { categoryStyleVars } from '../ui';
import { PERSONALITY_LABEL, differingBlockIds, scheduleSummary } from './model';
import { Empty, ExceptionsList } from './shared';
import type { ScreenProps } from './types';

/** תצוגה מוקטנת של השבוע: עמודה לכל יום, פס לכל בלוק. בלוקים שונים מהאחרים מודגשים. */
export function MiniWeek({
  schedule, dates, tasks, categories, differing,
}: { schedule: Schedule; dates: string[]; tasks: readonly Task[]; categories: readonly Category[]; differing: Set<string> }): JSX.Element {
  return (
    <div class="scr-mini" role="img" aria-label={`תצוגה מקדימה: ${PERSONALITY_LABEL[schedule.personality]}`}>
      {dates.map((d) => (
        <div key={d} class="scr-mini__day" data-date={d}>
          {schedule.blocks.filter((b) => b.range.date === d).map((b) => {
            const task = b.taskId ? tasks.find((t) => t.id === b.taskId) : undefined;
            const cat = task ? categories.find((c) => c.id === task.categoryId) : undefined;
            const style = {
              insetBlockStart: `${(b.range.startMin / 2880) * 100}%`,
              blockSize: `${((b.range.endMin - b.range.startMin) / 2880) * 100}%`,
              ...(cat ? categoryStyleVars(cat.color) : {}),
            };
            const cls = ['scr-mini__block', b.kind === 'sleep' ? 'is-sleep' : '', differing.has(b.id) ? 'is-diff' : ''].filter(Boolean).join(' ');
            return <span key={b.id} class={cls} style={style} data-block={b.id} />;
          })}
        </div>
      ))}
    </div>
  );
}

export function CompareScreen(p: ScreenProps): JSX.Element {
  const week = p.week;
  if (!week || week.schedules.length === 0) {
    return (
      <div class="scr-screen">
        <h1 class="scr-title">השוואת סידורים</h1>
        <Empty text="עדיין לא הופקו סידורים.">
          <Button onClick={() => p.actions.goto('entry')}>להזנת השבוע</Button>
        </Empty>
      </div>
    );
  }
  const dates = weekDates(week.startDate);
  return (
    <div class="scr-screen">
      <h1 class="scr-title">שלושה סידורים</h1>
      <p class="scr-muted">הבלוקים המודגשים ממוקמים אחרת בסידור אחר. גע בכרטיס כדי לבחור.</p>
      <div class="scr-compare">
        {week.schedules.map((s, i) => {
          const differing = differingBlockIds(week.schedules, i);
          const isSel = week.selectedScheduleId === s.id;
          return (
            <Card key={s.id} raised>
              <article class={isSel ? 'scr-variant is-selected' : 'scr-variant'} data-schedule={s.id} data-personality={s.personality}>
                <header class="scr-variant__head">
                  <h2 class="scr-h2">{PERSONALITY_LABEL[s.personality]}</h2>
                  <Badge tone="primary">ציון {Math.round(s.score.total)}</Badge>
                </header>
                <p class="scr-muted">{scheduleSummary(s)}</p>
                <MiniWeek schedule={s} dates={dates} tasks={p.tasks} categories={p.data.categories} differing={differing} />
                <ul class="scr-facts">
                  <li>{s.score.placedCount} מתוך {s.score.totalCount} משימות נכנסו</li>
                  <li>{s.score.breaksKept} הפסקות נשמרו</li>
                  <li>היום העמוס ביותר: {(s.score.maxDayLoadMin / 60).toFixed(1)} שעות</li>
                  <li data-diff-count={differing.size}>{differing.size} בלוקים שונים משאר הסידורים</li>
                </ul>
                <ExceptionsList report={s.exceptions} tasks={p.tasks} />
                <Button onClick={() => void p.actions.selectSchedule(s.id)}>{isSel ? 'פתח את הסידור הנבחר' : 'בחר סידור זה'}</Button>
              </article>
            </Card>
          );
        })}
      </div>
      <Button variant="secondary" disabled={p.busy} onClick={() => void p.actions.generate()}>הפק מחדש</Button>
    </div>
  );
}
