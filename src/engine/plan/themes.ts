import type { Id, Task } from '../../contracts';

/**
 * ימי נושא לכל קטגוריה (אישיות "נושאי יום"). הקטגוריות הגדולות קודם, כל אחת לימים
 * הפנויים ביותר עד שהקיבולת מכסה את הזמן שלה. דטרמיניסטי: שוויון נשבר לפי אינדקס יום.
 */
export function assignThemeDays(
  tasks: readonly Task[],
  activeDays: readonly number[],
  freeMin: readonly number[],
): Map<Id, Set<number>> {
  const minutes = new Map<Id, number>();
  for (const t of tasks) minutes.set(t.categoryId, (minutes.get(t.categoryId) ?? 0) + t.durationMin * Math.max(1, t.timesPerWeek));
  const cap = new Map(activeDays.map((d) => [d, freeMin[d] ?? 0]));
  const out = new Map<Id, Set<number>>();
  const cats = [...minutes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [cat, total] of cats) {
    const days = new Set<number>();
    let left = total;
    while (left > 0 && days.size < activeDays.length) {
      let pick = -1;
      for (const d of activeDays) {
        if (days.has(d)) continue;
        if (pick < 0 || (cap.get(d) ?? 0) > (cap.get(pick) ?? 0)) pick = d;
      }
      if (pick < 0) break;
      days.add(pick);
      const used = Math.min(left, Math.max(cap.get(pick) ?? 0, 0));
      cap.set(pick, (cap.get(pick) ?? 0) - used);
      left -= Math.max(used, 1);
    }
    out.set(cat, days);
  }
  return out;
}
