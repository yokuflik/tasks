import { GRID_MINUTES } from '../../contracts';
import type { Grid } from '../base';
import { TRAVEL_GAP_MIN } from '../base';
import { OCCUPANT, SLOTS_PER_DAY } from '../base';
import type { OccupantCode } from '../base';

export const slotOf = (min: number): number => Math.floor(min / GRID_MINUTES);

/** תופס או משחרר משבצות של טווח (דקות מוחלטות מיושרות לרשת). */
export function paint(grid: Grid, start: number, end: number, code: OccupantCode): void {
  const to = Math.min(Math.ceil(end / GRID_MINUTES), grid.slotCount);
  for (let s = Math.max(slotOf(start), 0); s < to; s++) grid.busy[s] = code;
}

/** ריפוד נסיעה לכל כיוון, מעוגל למעלה למשבצות. תופס מקום ברשת אבל אינו חלק מהמשימה. */
export const padOf = (travelMin: number): number => (travelMin <= 0 ? 0 : Math.ceil((travelMin + TRAVEL_GAP_MIN) / GRID_MINUTES) * GRID_MINUTES);

export const occupyTask = (grid: Grid, start: number, end: number, pad = 0): void => paint(grid, start - pad, end + pad, OCCUPANT.task);
export const release = (grid: Grid, start: number, end: number, pad = 0): void => paint(grid, start - pad, end + pad, OCCUPANT.free);

/**
 * האם אפשר לשים משימה בטווח: כל המשבצות פנויות, מותרות לפי מסכת המגבלות, וכולן באותו יום.
 * מקטע לא חוצה חצות, כדי שיוצג נקי בתצוגת יום.
 */
export function canPlace(grid: Grid, mask: Uint8Array, start: number, end: number, pad = 0): boolean {
  if (start % GRID_MINUTES !== 0 || end % GRID_MINUTES !== 0 || end <= start) return false;
  const a = start / GRID_MINUTES;
  const b = end / GRID_MINUTES;
  if (a < 0 || b > grid.slotCount) return false;
  if (Math.floor(a / SLOTS_PER_DAY) !== Math.floor((b - 1) / SLOTS_PER_DAY)) return false;
  for (let s = a; s < b; s++) {
    if (mask[s] === 0 || grid.busy[s] !== OCCUPANT.free) return false;
  }
  // הנסיעה רק צריכה להיות פנויה, בלי קשר לחלון הפעילות
  const padSlots = pad / GRID_MINUTES;
  for (let s = Math.max(0, a - padSlots); s < a; s++) if (grid.busy[s] !== OCCUPANT.free) return false;
  if (a - padSlots < 0) return false;
  if (b + padSlots > grid.slotCount) return false;
  for (let s = b; s < b + padSlots; s++) if (grid.busy[s] !== OCCUPANT.free) return false;
  return true;
}

/**
 * התחלות מועמדות למקטע באורך lenMin, מ-earliest ואילך: כל חצי שעה, וגם צמוד לקצה של זמן פנוי,
 * כדי לא להחמיץ מקום צמוד בלי לבדוק כל רבע שעה.
 */
export function candidateStarts(grid: Grid, mask: Uint8Array, lenMin: number, earliest: number, latestEnd = Infinity, pad = 0): number[] {
  const n = lenMin / GRID_MINUTES;
  const out: number[] = [];
  const first = Math.max(0, Math.ceil(earliest / GRID_MINUTES));
  const last = Math.min(grid.slotCount - n, Math.floor((latestEnd - lenMin) / GRID_MINUTES));
  const padSlots = pad / GRID_MINUTES;
  const blocked = (s: number): boolean => s < 0 || s >= grid.slotCount || mask[s] === 0 || grid.busy[s] !== OCCUPANT.free;
  for (let s = first; s <= last; s++) {
    if (!(s % 2 === 0 || blocked(s - 1 - padSlots) || blocked(s + n + padSlots))) continue;
    const start = s * GRID_MINUTES;
    if (canPlace(grid, mask, start, start + lenMin, pad)) out.push(start);
  }
  return out;
}
