import type { Id } from '../../contracts';
import { evaluate } from './score';
import { shuffled } from './rng';
import type { Rng } from './rng';
import { candidateStarts, canPlace, occupyTask, release } from './slots';
import type { PlanState } from './place';
import type { Piece } from './types';

/** תקרות דטרמיניסטיות (לפי מספר הערכות, לא זמן), כדי שהתוצאה לא תלויה במהירות המכשיר. */
export const MAX_PASSES = 4;
export const MAX_EVALUATIONS = 24_000;
/** שיפור קטן מזה לא נחשב: מונע ריצוד ועצירה מאוחרת. */
const MIN_GAIN = 1e-6;

function dependents(state: PlanState): Map<Id, Id[]> {
  const out = new Map<Id, Id[]>();
  for (const { task } of state.ctx.info.values()) {
    for (const d of task.dependsOn) out.set(d, [...(out.get(d) ?? []), task.id]);
  }
  return out;
}

function boundsFor(state: PlanState, deps: Map<Id, Id[]>, piece: Piece): { from: number; to: number } {
  const task = state.ctx.info.get(piece.taskId)?.task;
  let from = 0;
  let to = Infinity;
  for (const p of state.pieces) {
    if (p === piece) continue;
    if (task?.dependsOn.includes(p.taskId)) from = Math.max(from, p.end);
    if (deps.get(piece.taskId)?.includes(p.taskId)) to = Math.min(to, p.start);
  }
  return { from, to };
}

/** כל התלויות של משימה (אל מול התלויות שלה ומי שתלוי בה) מקוימות במצב הנוכחי. */
function dependenciesHold(state: PlanState, deps: Map<Id, Id[]>, taskId: Id): boolean {
  const check = (taskId2: Id): boolean => {
    const task = state.ctx.info.get(taskId2)?.task;
    if (!task) return true;
    const mine = state.pieces.filter((p) => p.taskId === taskId2);
    if (mine.length === 0) return true;
    const start = Math.min(...mine.map((p) => p.start));
    return task.dependsOn.every((d) => {
      const theirs = state.pieces.filter((p) => p.taskId === d);
      return theirs.length === 0 || Math.max(...theirs.map((p) => p.end)) <= start;
    });
  };
  return check(taskId) && (deps.get(taskId) ?? []).every(check);
}

/**
 * שיפור מקומי (DESIGN 9.1, שלב 5): הזזת חתיכה למקום טוב יותר, והחלפה בין שתי חתיכות באורך זהה.
 * מקבל רק שיפור ממשי, עוצר כשסבב שלם לא שיפר, ומוגבל במספר סבבים והערכות.
 * חתיכות קבועות ונעולות לא זזות. כל מגבלה קשיחה נבדקת לפני כל מהלך.
 */
export function improve(state: PlanState, rng: Rng): { passes: number; evaluations: number } {
  const deps = dependents(state);
  let evaluations = 0;
  let passes = 0;
  const cost = (): number => {
    evaluations++;
    return evaluate(state.ctx, state.pieces).cost;
  };
  let current = cost();

  const relocate = (piece: Piece): boolean => {
    const mask = state.ctx.masks.get(piece.taskId);
    if (!mask) return false;
    const len = piece.end - piece.start;
    const { from, to } = boundsFor(state, deps, piece);
    const [origStart, origEnd] = [piece.start, piece.end];
    const pad = state.ctx.pads.get(piece.taskId) ?? 0;
    release(state.ctx.grid, origStart, origEnd, pad);
    let best = current;
    let bestStart = origStart;
    for (const s of candidateStarts(state.ctx.grid, mask, len, from, to, pad)) {
      if (s === origStart) continue;
      if (evaluations >= MAX_EVALUATIONS) break;
      piece.start = s;
      piece.end = s + len;
      const c = cost();
      if (c < best - MIN_GAIN) {
        best = c;
        bestStart = s;
      }
    }
    piece.start = bestStart;
    piece.end = bestStart + len;
    occupyTask(state.ctx.grid, piece.start, piece.end, pad);
    if (bestStart === origStart) return false;
    current = best;
    return true;
  };

  const trySwap = (a: Piece, b: Piece): boolean => {
    const maskA = state.ctx.masks.get(a.taskId);
    const maskB = state.ctx.masks.get(b.taskId);
    if (!maskA || !maskB) return false;
    const len = a.end - a.start;
    if (b.end - b.start !== len || a.taskId === b.taskId) return false;
    if (a.start < b.end && b.start < a.end) return false;
    const pad = state.ctx.pads.get(a.taskId) ?? 0;
    if (pad !== (state.ctx.pads.get(b.taskId) ?? 0)) return false;
    const [as, bs] = [a.start, b.start];
    release(state.ctx.grid, as, as + len, pad);
    release(state.ctx.grid, bs, bs + len, pad);
    let done = false;
    if (canPlace(state.ctx.grid, maskA, bs, bs + len, pad) && canPlace(state.ctx.grid, maskB, as, as + len, pad)) {
      a.start = bs;
      a.end = bs + len;
      b.start = as;
      b.end = as + len;
      if (dependenciesHold(state, deps, a.taskId) && dependenciesHold(state, deps, b.taskId)) {
        const c = cost();
        if (c < current - MIN_GAIN) {
          current = c;
          done = true;
        }
      }
      if (!done) {
        a.start = as;
        a.end = as + len;
        b.start = bs;
        b.end = bs + len;
      }
    }
    occupyTask(state.ctx.grid, a.start, a.end, pad);
    occupyTask(state.ctx.grid, b.start, b.end, pad);
    return done;
  };

  for (; passes < MAX_PASSES && evaluations < MAX_EVALUATIONS; ) {
    passes++;
    let improved = false;
    const movable = shuffled(state.pieces.filter((p) => p.movable), rng);
    for (const piece of movable) {
      if (evaluations >= MAX_EVALUATIONS) break;
      if (relocate(piece)) improved = true;
    }
    for (let i = 0; i < movable.length; i++) {
      for (let j = i + 1; j < movable.length; j++) {
        if (evaluations >= MAX_EVALUATIONS) break;
        if (trySwap(movable[i]!, movable[j]!)) improved = true;
      }
    }
    if (!improved) break;
  }
  return { passes, evaluations };
}
