import { GRID_MINUTES } from '../../contracts';
import type { Category, Id, Task, UnplacedReason, UnplacedTask } from '../../contracts';
import { OCCUPANT, runsWhere } from './grid';
import type { Grid, OccupantCode } from './grid';
import { hasExplicitStart, slotProblem } from './constraints';
import type { SlotProblem } from './constraints';

/** קטגוריית הרופאים והבריאות. תור עם יום ושעה בה הוא חובה. */
export const APPOINTMENT_CATEGORY_ID = 'health';

/** חובה: עבודה (קבועה) או תור רפואי עם זמן קבוע. חובות אינן נדחות בגלל שינה, אלא מתריעות. */
export function isMandatoryTask(task: Task, categories: readonly Category[]): boolean {
  return (
    isFixedTask(task, categories) ||
    (task.categoryId === APPOINTMENT_CATEGORY_ID &&
      task.constraints.fixedDate !== undefined &&
      task.constraints.fixedStartMin !== undefined)
  );
}

/** משימה קבועה: לא זזה (קטגוריה קבועה, גמישות fixed, או תור רפואי עם זמן קבוע). */
export function isFixedTask(task: Task, categories: readonly Category[]): boolean {
  return (
    task.flexibility === 'fixed' ||
    (categories.find((c) => c.id === task.categoryId)?.fixed ?? false) ||
    (task.categoryId === APPOINTMENT_CATEGORY_ID &&
      task.constraints.fixedDate !== undefined &&
      task.constraints.fixedStartMin !== undefined)
  );
}

/** רכיבים קשירים חזק בגרף התלויות; מחזיר רק מעגלים (גודל > 1 או לולאה עצמית), בסדר הקלט. */
export function findDependencyCycles(tasks: readonly Task[]): Id[][] {
  const order = new Map(tasks.map((t, i) => [t.id, i]));
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn.filter((d) => order.has(d))]));
  let counter = 0;
  const index = new Map<Id, number>();
  const low = new Map<Id, number>();
  const onStack = new Set<Id>();
  const stack: Id[] = [];
  const cycles: Id[][] = [];

  const visit = (v: Id): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: Id[] = [];
      let w: Id;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || (deps.get(v) ?? []).includes(v)) {
        cycles.push(comp.sort((a, b) => order.get(a)! - order.get(b)!));
      }
    }
  };
  for (const t of tasks) if (!index.has(t.id)) visit(t.id);
  return cycles;
}

const SUGGESTION: Record<UnplacedReason, string> = {
  not_enough_time: 'אין מספיק זמן פנוי. אפשר לפנות זמן, לשחרר זמן חסום או לקצר את המשימה.',
  deadline_conflict: 'אין זמן פנוי עד תאריך היעד. אפשר לדחות את היעד או לפנות זמן לפניו.',
  larger_than_any_window: 'המשימה ארוכה מכל חלון פנוי. אפשר לאפשר פיצול, לקצר אותה או להרחיב את שעות הפעילות.',
  forbidden_time: 'הימים והשעות האסורים שוללים את כל השבוע. אפשר לשחרר יום או חלון זמן.',
  fixed_conflict: 'הזמן הקבוע של המשימה מתנגש. אפשר לשנות את הזמן או לפנות את מה שמתנגש.',
  circular_dependency: 'יש מעגל תלויות בין המשימות. יש להסיר תלות אחת במעגל.',
  dependency_unplaced: 'משימה שהיא תלויה בה לא שובצה, ולכן גם היא לא.',
  would_break_sleep: 'שיבוץ המשימה ישבור את מינימום השינה. אפשר לפנות זמן סביב השינה.',
};

export function suggestionFor(reason: UnplacedReason): string {
  return SUGGESTION[reason];
}

const WINDOW: readonly SlotProblem[] = ['window'];
const CONSTRAINTS: readonly SlotProblem[] = ['window', 'weekday', 'forbidden_window', 'allowed_window', 'fixed_time'];

/** האם המשימה (מופע אחד) נכנסת בזמן שנשאר: רצף אחד, או לפי מקטעים אם ניתנת לפיצול. */
function fits(task: Task, runsSlots: number[]): boolean {
  const need = Math.ceil(task.durationMin / GRID_MINUTES);
  if (task.split.splittable) {
    const seg = Math.min(Math.ceil((task.split.minSegmentMin ?? GRID_MINUTES) / GRID_MINUTES), need);
    return runsSlots.filter((r) => r >= seg).reduce((a, b) => a + b, 0) >= need;
  }
  return runsSlots.some((r) => r >= need);
}

function runsOf(grid: Grid, task: Task, only: readonly SlotProblem[] | undefined, accept: readonly OccupantCode[]): number[] {
  return runsWhere(grid, (s) => {
    if (slotProblem(grid, task, s, only) !== null) return false;
    const b = grid.busy[s] as OccupantCode;
    return b === OCCUPANT.free || accept.includes(b);
  }).map((r) => (r.end - r.start) / GRID_MINUTES);
}

const ALL_BUSY: readonly OccupantCode[] = [OCCUPANT.fixed, OCCUPANT.blocked, OCCUPANT.sleep, OCCUPANT.locked, OCCUPANT.task];

/**
 * סיבה לכך שמשימה גמישה אינה יכולה להיכנס בשום מקום (בנפרד משאר המשימות), או null אם יכולה.
 * הסדר: מגבלות, תאריך יעד, זמן תפוס (משמרות וחסומים), ולבסוף שינה.
 */
export function classifyInfeasible(grid: Grid, task: Task): UnplacedReason | null {
  const exact = hasExplicitStart(task) && task.constraints.fixedDate !== undefined;
  const windowOnly = runsOf(grid, task, WINDOW, ALL_BUSY);
  const constrained = runsOf(grid, task, CONSTRAINTS, ALL_BUSY);
  if (constrained.length === 0) return windowOnly.length === 0 ? 'larger_than_any_window' : 'forbidden_time';
  if (!fits(task, constrained)) {
    return fits(task, windowOnly) ? 'forbidden_time' : 'larger_than_any_window';
  }
  const dated = runsOf(grid, task, undefined, ALL_BUSY);
  if (!fits(task, dated)) return 'deadline_conflict';
  if (!fits(task, runsOf(grid, task, undefined, [OCCUPANT.sleep]))) {
    return exact ? 'fixed_conflict' : 'not_enough_time';
  }
  if (!fits(task, runsOf(grid, task, undefined, []))) return 'would_break_sleep';
  return null;
}

/**
 * דוח חריגים לשלב הבסיס: משימות גמישות שלא ניתן לשבץ בכלל.
 * מעגלי תלות, אי התאמה למגבלות/חלונות/יעד/זמן תפוס/שינה, והעברת כשל לתלויות.
 * alreadyUnplaced: משימות שכבר נכשלו (למשל משמרות בהתנגשות), להעברה לתלויות.
 */
export function analyzeTasks(
  grid: Grid,
  tasks: readonly Task[],
  categories: readonly Category[],
  alreadyUnplaced: readonly UnplacedTask[] = [],
): UnplacedTask[] {
  const live = tasks.filter((t) => t.status !== 'done');
  const out = new Map<Id, UnplacedTask>();
  const failed = new Set<Id>(alreadyUnplaced.map((u) => u.taskId));

  for (const cycle of findDependencyCycles(live)) {
    for (const id of cycle) {
      out.set(id, { taskId: id, reason: 'circular_dependency', relatedTaskIds: cycle, suggestion: SUGGESTION.circular_dependency });
      failed.add(id);
    }
  }
  for (const t of live) {
    if (failed.has(t.id) || isFixedTask(t, categories)) continue;
    const reason = classifyInfeasible(grid, t);
    if (reason) {
      out.set(t.id, { taskId: t.id, reason, suggestion: SUGGESTION[reason] });
      failed.add(t.id);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of live) {
      if (failed.has(t.id)) continue;
      const bad = t.dependsOn.filter((d) => failed.has(d));
      if (bad.length > 0) {
        out.set(t.id, { taskId: t.id, reason: 'dependency_unplaced', relatedTaskIds: bad, suggestion: SUGGESTION.dependency_unplaced });
        failed.add(t.id);
        changed = true;
      }
    }
  }
  return live.flatMap((t) => out.get(t.id) ?? []);
}
