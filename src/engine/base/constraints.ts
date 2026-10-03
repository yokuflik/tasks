import { GRID_MINUTES } from '../../contracts';
import type { Task, TimeWindow } from '../../contracts';
import { dayDiff, weekdayOf } from './dates';
import { SLOTS_PER_DAY } from './grid';
import type { Grid } from './grid';

/** למה משבצת אסורה למשימה. */
export type SlotProblem =
  | 'window'
  | 'weekday'
  | 'forbidden_window'
  | 'allowed_window'
  | 'fixed_time'
  | 'deadline';

const ORDER: readonly SlotProblem[] = [
  'window',
  'weekday',
  'forbidden_window',
  'allowed_window',
  'fixed_time',
  'deadline',
];

/** חלון יכול לחצות חצות (endMin מעל 1440). */
function covers(min: number, w: TimeWindow, len: number): boolean {
  return (min >= w.startMin && min + len <= w.endMin) || (min + 1440 >= w.startMin && min + 1440 + len <= w.endMin);
}
function overlaps(min: number, w: TimeWindow, len: number): boolean {
  return (min < w.endMin && min + len > w.startMin) || (min + 1440 < w.endMin && min + 1440 + len > w.startMin);
}

/** משימה עם שעה קבועה מפורשת: חלון הפעילות לא חל עליה. */
export function hasExplicitStart(task: Task): boolean {
  return task.constraints.fixedStartMin !== undefined;
}

/**
 * האם המשימה רשאית לתפוס את המשבצת, מבחינת מגבלות המשימה בלבד (לא תפוסה).
 * only: בודק רק את הסוגים האלה.
 */
export function slotProblem(
  grid: Grid,
  task: Task,
  slot: number,
  only?: readonly SlotProblem[],
): SlotProblem | null {
  const c = task.constraints;
  const abs = slot * GRID_MINUTES;
  const dayIdx = Math.floor(slot / SLOTS_PER_DAY);
  const min = abs - dayIdx * 1440;
  const date = grid.dates[dayIdx];
  for (const p of ORDER) {
    if (only && !only.includes(p)) continue;
    switch (p) {
      case 'window':
        if (hasExplicitStart(task) ? !grid.activeDay[dayIdx] : !grid.open[slot]) return p;
        break;
      case 'weekday':
        if (date && c.forbiddenWeekdays?.includes(weekdayOf(date))) return p;
        break;
      case 'forbidden_window':
        if (c.forbiddenWindows?.some((w) => overlaps(min, w, GRID_MINUTES))) return p;
        break;
      case 'allowed_window':
        if (c.allowedWindow && !covers(min, c.allowedWindow, GRID_MINUTES)) return p;
        break;
      case 'fixed_time': {
        if (c.fixedDate !== undefined && date !== c.fixedDate) return p;
        if (c.fixedStartMin !== undefined) {
          if (c.fixedDate !== undefined) {
            const start = dayDiff(grid.originDate, c.fixedDate) * 1440 + c.fixedStartMin;
            if (abs < start || abs >= start + task.durationMin) return p;
          } else if (!(covers(min, { startMin: c.fixedStartMin, endMin: c.fixedStartMin + task.durationMin }, GRID_MINUTES))) {
            return p;
          }
        }
        break;
      }
      case 'deadline':
        if (task.dueDate !== undefined && dayIdx > dayDiff(grid.originDate, task.dueDate)) return p;
        break;
    }
  }
  return null;
}

/** מסכה (1 = מותר) לפי מגבלות המשימה, ללא תפוסה. לשימוש P4. */
export function taskMask(grid: Grid, task: Task, only?: readonly SlotProblem[]): Uint8Array {
  const m = new Uint8Array(grid.slotCount);
  for (let s = 0; s < grid.slotCount; s++) m[s] = slotProblem(grid, task, s, only) === null ? 1 : 0;
  return m;
}
