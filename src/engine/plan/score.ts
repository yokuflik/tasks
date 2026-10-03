import { GRID_MINUTES } from '../../contracts';
import type { Id, ScoreBreakdown } from '../../contracts';
import { SOFT_RULES } from './personalities';
import type { SoftRule } from './personalities';
import type { Ctx, Piece } from './types';

const DAY = 1440;
const HEAVY_LATE_FROM = 16 * 60;
const LIGHT_EARLY_UNTIL = 12 * 60;
const BUFFER_TARGET_MIN = 60;
/** משימות שאינן עבודה מועדפות בין 08:00 ל-23:00; מחוץ לזה רק אם אין ברירה. */
const DAY_FROM_MIN = 8 * 60;
const DAY_TO_MIN = 23 * 60;
const HEAVY_RUN_MAX_MIN = 120;
const DEFAULT_MAX_CONSECUTIVE_MIN = 240;
const PRIORITY_WEIGHT = { high: 3, medium: 1.5, low: 0.5 } as const;
export const PRIORITY_WEIGHTS = PRIORITY_WEIGHT;

export type Penalties = Record<SoftRule, number>;

export interface Evaluation {
  /** קנס גולמי לכל חוק, לפני משקל. */
  raw: Penalties;
  weighted: Penalties;
  cost: number;
  breaksKept: number;
  maxDayLoadMin: number;
}

function emptyPenalties(): Penalties {
  const p = {} as Penalties;
  for (const r of SOFT_RULES) p[r] = 0;
  return p;
}

/** קיבוץ חתיכות לפי יום ההתחלה, ממוינות בזמן. */
function byDay(pieces: readonly Piece[]): Map<number, Piece[]> {
  const days = new Map<number, Piece[]>();
  for (const p of pieces) {
    const d = Math.floor(p.start / DAY);
    const list = days.get(d);
    if (list) list.push(p);
    else days.set(d, [p]);
  }
  for (const list of days.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return days;
}

/**
 * הערכת הסידור לפי החוקים הרכים (DESIGN 9.3). קנס נמוך = טוב יותר.
 * מחושב מחדש מהחתיכות בלבד, ולכן דטרמיניסטי ובלתי תלוי בהיסטוריית השיבוץ.
 */
export function evaluate(ctx: Ctx, pieces: readonly Piece[]): Evaluation {
  const raw = emptyPenalties();
  const days = byDay(pieces);
  const minBreak = ctx.settings.minBreakMin;
  const maxRun = ctx.settings.maxConsecutiveMin ?? DEFAULT_MAX_CONSECUTIVE_MIN;
  let breaksKept = 0;

  const loads: number[] = [];
  let maxDayLoadMin = 0;
  for (const d of ctx.activeDays) {
    const list = days.get(d) ?? [];
    const load = list.reduce((a, p) => a + (p.end - p.start), 0);
    loads.push(load);
    maxDayLoadMin = Math.max(maxDayLoadMin, load);
  }
  const mean = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
  raw.loadBalance = loads.reduce((a, l) => a + Math.abs(l - mean), 0) / 60;

  for (const d of ctx.activeDays) {
    const list = days.get(d) ?? [];
    let flexMin = 0;
    const cats = new Set<Id>();
    let runLen = 0;
    let heavyRun = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      const info = ctx.info.get(p.taskId);
      const dur = p.end - p.start;
      if (p.movable) flexMin += dur;
      const catId = info?.task.categoryId ?? '';
      if (info && !info.fixed) cats.add(catId);

      const prev = i > 0 ? list[i - 1]! : undefined;
      const gap = prev ? p.start - prev.end : Infinity;
      if (prev) {
        if (gap >= minBreak) breaksKept++;
        else raw.breaks += (minBreak - Math.max(gap, 0)) / GRID_MINUTES;
        if (ctx.info.get(prev.taskId)?.task.categoryId !== catId) raw.contextSwitch++;
      }
      runLen = gap < minBreak ? runLen + dur : dur;
      if (runLen > maxRun) raw.consecutive += Math.min(dur, runLen - maxRun) / 60;

      const heavy = info?.task.effort === 'heavy';
      const prevHeavySame =
        prev !== undefined &&
        heavy &&
        ctx.info.get(prev.taskId)?.task.effort === 'heavy' &&
        ctx.info.get(prev.taskId)?.task.categoryId === catId &&
        gap < 60;
      heavyRun = prevHeavySame ? heavyRun + dur : heavy ? dur : 0;
      if (heavyRun > HEAVY_RUN_MAX_MIN) raw.heavyStreak += Math.min(dur, heavyRun - HEAVY_RUN_MAX_MIN) / 60;

      const minOfDay = p.start - d * DAY;
      const w = info?.category?.preferredWindow;
      if (w) {
        const out = Math.max(0, w.startMin - minOfDay) + Math.max(0, minOfDay + dur - w.endMin);
        raw.preferredWindow += Math.min(out, dur) / 60;
      }
      if (heavy) raw.effortOrder += Math.max(0, Math.min(dur, minOfDay + dur - HEAVY_LATE_FROM)) / 60;
      else if (info?.task.effort === 'light') {
        raw.effortOrder += (0.3 * Math.max(0, Math.min(dur, LIGHT_EARLY_UNTIL - minOfDay))) / 60;
      }

      if (info && !info.fixed) {
        const themed = ctx.themeDays.get(catId);
        if (themed && !themed.has(d)) raw.themeMismatch += dur / 60;
      }
      if (info?.task.categoryId !== 'work') {
        const a = p.start - d * DAY;
        const b = a + dur;
        const inside = Math.max(0, Math.min(b, DAY_TO_MIN) - Math.max(a, DAY_FROM_MIN));
        raw.offHours += (dur - inside) / 60;
      }
      if (p.movable && info) {
        const urgency = info.task.dueDate !== undefined ? 2 : 1;
        const offset = p.start / DAY / 7;
        raw.earliness += (PRIORITY_WEIGHT[info.task.priority] * urgency * offset * dur) / 60;
      }
    }
    raw.themeSpread += Math.max(0, cats.size - 1);
    raw.buffer += Math.max(0, BUFFER_TARGET_MIN - ((ctx.baseFreeMin[d] ?? 0) - flexMin)) / 60;
  }

  // חזרתיות: מופעים שונים של אותה משימה באותו יום
  const perTask = new Map<Id, Map<number, Set<number>>>();
  for (const p of pieces) {
    if ((ctx.info.get(p.taskId)?.task.timesPerWeek ?? 1) < 2) continue;
    const d = Math.floor(p.start / DAY);
    let m = perTask.get(p.taskId);
    if (!m) perTask.set(p.taskId, (m = new Map()));
    let s = m.get(d);
    if (!s) m.set(d, (s = new Set()));
    s.add(p.occurrence);
  }
  for (const m of perTask.values()) for (const s of m.values()) raw.repeatSpread += Math.max(0, s.size - 1);

  const weighted = emptyPenalties();
  let cost = 0;
  for (const r of SOFT_RULES) {
    weighted[r] = raw[r] * ctx.weights[r];
    cost += weighted[r];
  }
  return { raw, weighted, cost, breaksKept, maxDayLoadMin };
}

/**
 * ציון כולל 0..100: 100 כפול שיעור המשימות שנכנסו, פחות הקנס המשוקלל לכל חתיכה גמישה.
 * הקנסות המפורטים נשמרים ב-penalties כדי שאפשר להסביר את הציון.
 */
export function toBreakdown(
  ev: Evaluation,
  counts: { placed: number; total: number; movablePieces: number },
): ScoreBreakdown {
  const ratio = counts.total === 0 ? 1 : counts.placed / counts.total;
  const total = Math.max(0, Math.min(100, Math.round(100 * ratio - ev.cost / Math.max(1, counts.movablePieces))));
  const penalties: Record<string, number> = {};
  for (const r of SOFT_RULES) penalties[r] = Math.round(ev.weighted[r] * 100) / 100;
  return {
    total,
    placedCount: counts.placed,
    totalCount: counts.total,
    breaksKept: ev.breaksKept,
    maxDayLoadMin: ev.maxDayLoadMin,
    penalties,
  };
}
