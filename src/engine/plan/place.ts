import { GRID_MINUTES } from '../../contracts';
import type { Id, Personality, Task, UnplacedReason, UnplacedTask } from '../../contracts';
import { classifyInfeasible, suggestionFor } from '../base';
import { evaluate } from './score';
import { PRIORITY_WEIGHTS } from './score';
import { candidateStarts, occupyTask, release } from './slots';
import type { Rng } from './rng';
import type { Ctx, Piece } from './types';

/** חבילת מצב משותפת לשיבוץ ולשיפור. */
export interface PlanState {
  ctx: Ctx;
  pieces: Piece[];
  unplaced: Map<Id, UnplacedTask>;
}

/** הפרש עלות שנחשב שוויון. בתוך הטווח הזה הזרע קובע (שבירת שוויון בלבד). */
export const TIE_EPSILON = 0.05;

/** מופע אחד לשיבוץ: משימה ומספר מופע (חזרתיות) ואורך בדקות. */
export interface Instance {
  task: Task;
  occurrence: number;
  durationMin: number;
}

export function nextSegment(pieces: readonly Piece[], taskId: Id): number {
  let max = -1;
  for (const p of pieces) if (p.taskId === taskId && p.segment > max) max = p.segment;
  return max + 1;
}

/** המועד המוקדם ביותר שבו משימה רשאית להתחיל: אחרי סיום כל התלויות שלה. */
export function earliestStart(pieces: readonly Piece[], task: Task): number {
  let at = 0;
  for (const dep of task.dependsOn) for (const p of pieces) if (p.taskId === dep && p.end > at) at = p.end;
  return at;
}

/** כמה משבצות התחלה יש למשימה מלאה, כמדד לקושי. */
export function feasibleStartCount(ctx: Ctx, task: Task): number {
  const mask = ctx.masks.get(task.id);
  if (!mask) return 0;
  return candidateStarts(ctx.grid, mask, Math.max(GRID_MINUTES, task.durationMin), 0, Infinity, ctx.pads.get(task.id) ?? 0).length;
}

/**
 * סדר טיפול (DESIGN 9.1, שלב 3): קבועות עם יום ושעה, אחר כך תאריך יעד או מגבלות, ואז גמישות.
 * בתוך שכבה: עדיפות, ומפתח האישיות (מוקדם: יעד; נושאי יום: קטגוריה; מאוזן: קושי), ואז קושי.
 * תלות קובעת סדר מחייב: משימה מטופלת רק אחרי שהתלויות שלה טופלו.
 */
export function orderTasks(ctx: Ctx, tasks: readonly Task[], personality: Personality): Task[] {
  const hard = new Map<Id, number>(tasks.map((t) => [t.id, feasibleStartCount(ctx, t)]));
  const tier = (t: Task): number => {
    const c = t.constraints;
    if (c.fixedDate !== undefined && c.fixedStartMin !== undefined) return 0;
    const narrow =
      t.dueDate !== undefined ||
      c.fixedDate !== undefined ||
      c.allowedWindow !== undefined ||
      (c.forbiddenWeekdays?.length ?? 0) > 0 ||
      (c.forbiddenWindows?.length ?? 0) > 0;
    return narrow ? 1 : 2;
  };
  const catOrder = new Map<Id, number>();
  for (const t of [...tasks].sort((a, b) => a.categoryId.localeCompare(b.categoryId))) {
    if (!catOrder.has(t.categoryId)) catOrder.set(t.categoryId, catOrder.size);
  }
  const key = (t: Task): number[] => {
    const prio = -PRIORITY_WEIGHTS[t.priority];
    const due = t.dueDate !== undefined ? Date.parse(t.dueDate) / 86_400_000 : Infinity;
    const difficulty = hard.get(t.id) ?? 0;
    switch (personality) {
      case 'early':
        return [tier(t), prio, due, difficulty, -t.durationMin];
      case 'themed':
        return [tier(t), catOrder.get(t.categoryId) ?? 0, prio, difficulty, -t.durationMin];
      default:
        return [tier(t), prio, difficulty, due, -t.durationMin];
    }
  };
  const cmp = (a: Task, b: Task): number => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const d = ka[i]! - kb[i]!;
      if (d !== 0 && !Number.isNaN(d)) return d;
    }
    return a.id.localeCompare(b.id);
  };

  const pending = new Set(tasks.map((t) => t.id));
  const remaining = [...tasks].sort(cmp);
  const out: Task[] = [];
  while (remaining.length > 0) {
    // הראשון שכל התלויות שלו (בתוך הקבוצה) כבר טופלו; אין מעגלים כאן (P3 סינן)
    let idx = remaining.findIndex((t) => t.dependsOn.every((d) => !pending.has(d) || d === t.id));
    if (idx < 0) idx = 0;
    const [t] = remaining.splice(idx, 1);
    pending.delete(t!.id);
    out.push(t!);
  }
  return out;
}

function pickBest(
  state: PlanState,
  piece: Omit<Piece, 'start' | 'end'>,
  lenMin: number,
  starts: readonly number[],
  rng: Rng,
): number | null {
  let best = Infinity;
  let chosen: number | null = null;
  let ties = 0;
  for (const s of starts) {
    state.pieces.push({ ...piece, start: s, end: s + lenMin });
    const cost = evaluate(state.ctx, state.pieces).cost;
    state.pieces.pop();
    if (cost < best - TIE_EPSILON) {
      best = cost;
      chosen = s;
      ties = 1;
    } else if (cost <= best + TIE_EPSILON) {
      ties++;
      if (rng() * ties < 1) chosen = s;
      if (cost < best) best = cost;
    }
  }
  return chosen;
}

function commit(state: PlanState, task: Task, occurrence: number, start: number, lenMin: number): Piece {
  const segment = nextSegment(state.pieces, task.id);
  const piece: Piece = {
    id: `p-${task.id}-${segment}`,
    taskId: task.id,
    segment,
    occurrence,
    start,
    end: start + lenMin,
    movable: true,
  };
  state.pieces.push(piece);
  occupyTask(state.ctx.grid, piece.start, piece.end, state.ctx.pads.get(task.id) ?? 0);
  return piece;
}

function rollback(state: PlanState, added: Piece[]): void {
  for (const p of added) {
    release(state.ctx.grid, p.start, p.end, state.ctx.pads.get(p.taskId) ?? 0);
    state.pieces.splice(state.pieces.indexOf(p), 1);
  }
}

/** חלוקה של N משבצות ל-k מקטעים שווים בערך, כל אחד לפחות min. */
function splitSizes(totalSlots: number, k: number): number[] {
  const base = Math.floor(totalSlots / k);
  const extra = totalSlots - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** משבץ מופע אחד: קודם ברצף, ואם לא נכנס ואפשר לפצל, במקטעים. מחזיר false אם אין מקום. */
export function placeInstance(state: PlanState, inst: Instance, rng: Rng): boolean {
  const { task, occurrence, durationMin } = inst;
  const mask = state.ctx.masks.get(task.id);
  if (!mask) return false;
  const earliest = earliestStart(state.pieces, task);
  const base = { taskId: task.id, occurrence, movable: true };
  const idOf = (): Omit<Piece, 'start' | 'end'> => {
    const segment = nextSegment(state.pieces, task.id);
    return { ...base, id: `p-${task.id}-${segment}`, segment };
  };

  const pad = state.ctx.pads.get(task.id) ?? 0;
  const whole = candidateStarts(state.ctx.grid, mask, durationMin, earliest, Infinity, pad);
  if (whole.length > 0) {
    const start = pickBest(state, idOf(), durationMin, whole, rng);
    if (start !== null) {
      commit(state, task, occurrence, start, durationMin);
      return true;
    }
  }
  if (!task.split.splittable) return false;

  const need = durationMin / GRID_MINUTES;
  const minSeg = Math.min(Math.max(1, Math.ceil((task.split.minSegmentMin ?? GRID_MINUTES) / GRID_MINUTES)), need);
  for (let k = 2; k <= Math.floor(need / minSeg); k++) {
    const sizes = splitSizes(need, k);
    const added: Piece[] = [];
    let ok = true;
    for (const size of sizes) {
      const len = size * GRID_MINUTES;
      const starts = candidateStarts(state.ctx.grid, mask, len, earliest, Infinity, pad);
      const start = starts.length > 0 ? pickBest(state, idOf(), len, starts, rng) : null;
      if (start === null) {
        ok = false;
        break;
      }
      added.push(commit(state, task, occurrence, start, len));
    }
    if (ok) return true;
    rollback(state, added);
  }
  return false;
}

/** סיבת הכישלון של מופע שלא נכנס, מתוך הרשימה הסגורה בחוזה. */
export function failureReason(state: PlanState, task: Task): UnplacedReason {
  const grid = state.ctx.grid;
  const alone = classifyInfeasible(grid, task);
  if (alone === 'not_enough_time' && task.dueDate !== undefined) {
    const noDeadline: Task = { ...task };
    delete noDeadline.dueDate;
    if (classifyInfeasible(grid, noDeadline) === null) return 'deadline_conflict';
  }
  if (alone) return alone;
  // נכנסת בנפרד אבל לא אחרי התלויות שלה
  return task.dueDate !== undefined ? 'deadline_conflict' : 'not_enough_time';
}

export function markUnplaced(state: PlanState, task: Task, reason: UnplacedReason, related?: Id[]): void {
  if (state.unplaced.has(task.id)) return;
  state.unplaced.set(task.id, {
    taskId: task.id,
    reason,
    ...(related ? { relatedTaskIds: related } : {}),
    suggestion: suggestionFor(reason),
  });
}

/** פורס את המשימה למופעים, פחות מה שכבר נעול ידנית. */
export function instancesOf(task: Task, lockedMin: number, lockedCount: number): Instance[] {
  const times = Math.max(1, task.timesPerWeek);
  if (times > 1) {
    const left = Math.max(0, times - lockedCount);
    return Array.from({ length: left }, (_, i) => ({ task, occurrence: lockedCount + i, durationMin: task.durationMin }));
  }
  const rest = lockedMin > 0 ? Math.max(0, task.durationMin - lockedMin) : task.durationMin;
  return rest > 0 ? [{ task, occurrence: 0, durationMin: rest }] : [];
}

/** שיבוץ חמדני: לכל מופע, לפי הסדר, המקום בעל העלות הנמוכה ביותר. */
export function greedyPlace(state: PlanState, ordered: readonly Task[], locked: ReadonlyMap<Id, { min: number; count: number }>, rng: Rng): void {
  for (const task of ordered) {
    const failedDeps = task.dependsOn.filter((d) => state.unplaced.has(d));
    if (failedDeps.length > 0) {
      markUnplaced(state, task, 'dependency_unplaced', failedDeps);
      continue;
    }
    const l = locked.get(task.id);
    for (const inst of instancesOf(task, l?.min ?? 0, l?.count ?? 0)) {
      if (!placeInstance(state, inst, rng)) {
        markUnplaced(state, task, failureReason(state, task));
        break;
      }
    }
  }
}

/**
 * ניסיון שני למשימות שנכשלו בשיבוץ החמדני, אחרי שהשיפור המקומי פינה מקום.
 * מנסה רק מופעים חסרים, ומוחק מהדוח כל משימה שנכנסה במלואה. מחזיר true אם משהו השתנה.
 */
export function retryUnplaced(
  state: PlanState,
  ordered: readonly Task[],
  locked: ReadonlyMap<Id, { min: number; count: number }>,
  rng: Rng,
): boolean {
  let changed = false;
  for (let again = true; again; ) {
    again = false;
    for (const task of ordered) {
      const entry = state.unplaced.get(task.id);
      if (!entry) continue;
      if (task.dependsOn.some((d) => state.unplaced.has(d))) continue;
      const have = new Set(state.pieces.filter((p) => p.taskId === task.id && p.movable).map((p) => p.occurrence));
      const l = locked.get(task.id);
      const missing = instancesOf(task, l?.min ?? 0, l?.count ?? 0).filter((i) => !have.has(i.occurrence));
      let ok = true;
      for (const inst of missing) {
        if (!placeInstance(state, inst, rng)) {
          ok = false;
          break;
        }
        changed = true;
      }
      if (ok) {
        state.unplaced.delete(task.id);
        again = true;
      }
    }
  }
  return changed;
}
