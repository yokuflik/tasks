import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../../../contracts/defaults';
import type { IsoDate, ScheduleBlock, Task, Week } from '../../../contracts';
import type { PrepareInput } from '../prepare';
import { addDays } from '../dates';

export const START: IsoDate = '2026-06-07'; // יום ראשון
export const DAYS: IsoDate[] = Array.from({ length: 7 }, (_, i) => addDays(START, i));

export function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    categoryId: 'errands',
    durationMin: 60,
    priority: 'medium',
    constraints: {},
    flexibility: 'flexible',
    split: { splittable: false },
    dependsOn: [],
    effort: 'medium',
    timesPerWeek: 1,
    status: 'pending',
    ...over,
  };
}

/** משמרת עבודה: קבועה, ביום (אינדקס מ-0) ובשעה נתונים. */
export function shift(id: string, dayIdx: number, startMin: number, durationMin: number): Task {
  return task(id, {
    categoryId: 'work',
    durationMin,
    flexibility: 'fixed',
    constraints: { fixedDate: DAYS[dayIdx]!, fixedStartMin: startMin },
  });
}

export function week(over: Partial<Week> = {}): Week {
  return { id: 'w', startDate: START, activeDates: DAYS, blockedTimes: [], taskIds: [], schedules: [], ...over };
}

export function input(tasks: Task[], w: Week = week(), lockedBlocks: ScheduleBlock[] = []): PrepareInput {
  return {
    week: w,
    tasks,
    categories: DEFAULT_CATEGORIES,
    settings: DEFAULT_SETTINGS,
    lockedBlocks,
  };
}
