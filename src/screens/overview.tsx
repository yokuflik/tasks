import type { JSX } from 'preact';
import { hebrewDate, weekDates } from '../time';
import { CategoryDistributionBar, DayLoadBar, formatDuration } from '../ui';
import { categoryTotals, dayAvailableMin, dayLoadMin, shortDate, sleepMinForNight } from './model';
import { ExceptionsList, NeedSchedule, WeekHeader, weekdayName, DayMarks } from './shared';
import type { ScreenProps } from './types';

export function OverviewScreen(p: ScreenProps): JSX.Element {
  if (!p.week || !p.selected) {
    return (
      <div class="scr-screen">
        <WeekHeader title="סקירת שבוע" weekStart={p.weekStart} actions={p.actions} />
        <NeedSchedule p={p} />
      </div>
    );
  }
  const { week, selected } = { week: p.week, selected: p.selected };
  const totals = categoryTotals(selected.blocks, p.tasks, p.data.categories);
  const sleepMin = p.data.settings.minSleepMin;
  return (
    <div class="scr-screen">
      <WeekHeader title="סקירת שבוע" weekStart={p.weekStart} actions={p.actions} />
      <section aria-label="חלוקת זמן לפי קטגוריות">
        <h2 class="scr-h2">חלוקת הזמן</h2>
        {totals.length > 0 ? <CategoryDistributionBar items={totals} /> : <p class="scr-muted">אין משימות משובצות.</p>}
      </section>
      <section aria-label="שינה ועומס לפי יום">
        <h2 class="scr-h2">שינה ועומס</h2>
        <ul class="scr-days">
          {weekDates(week.startDate).map((d) => {
            const sleep = sleepMinForNight(selected.blocks, d);
            const load = dayLoadMin(selected.blocks, d);
            return (
              <li key={d} data-date={d} class="scr-days__row">
                <div class="scr-days__name">
                  <strong>{weekdayName(d)} {shortDate(d)}</strong>
                  <span class="scr-muted">{hebrewDate(d)}</span>
                  <DayMarks date={d} />
                </div>
                <div class="scr-days__stats">
                  <span data-sleep={sleep} class={sleep > 0 && sleep < sleepMin ? 'scr-short' : ''}>
                    שינה בלילה: {sleep > 0 ? formatDuration(sleep) : 'לא נקבעה'}
                  </span>
                  <span data-load={load}>עומס: {formatDuration(load)}</span>
                </div>
                <DayLoadBar loadMin={load} availableMin={dayAvailableMin(week, selected.blocks, d)} />
              </li>
            );
          })}
        </ul>
      </section>
      <ExceptionsList report={selected.exceptions} tasks={p.tasks} />
    </div>
  );
}
