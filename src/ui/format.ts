import type { Minutes } from '../contracts';

/** דקות מחצות לשעון קיר "HH:MM". ערך מעל 1440 (חוצה חצות) עובר לגלישה. */
export function formatTime(min: Minutes): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function formatRange(startMin: Minutes, endMin: Minutes): string {
  return `${formatTime(startMin)}–${formatTime(endMin)}`;
}

/** משך בעברית: "שעה", "2 ש׳ 30 ד׳", "45 ד׳". */
export function formatDuration(min: Minutes): string {
  const t = Math.max(0, Math.round(min));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m} ד׳`;
  if (m === 0) return h === 1 ? 'שעה' : `${h} ש׳`;
  return `${h} ש׳ ${m} ד׳`;
}
