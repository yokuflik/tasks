import type { Schedule, ScheduleBlock } from '../../contracts';

/** בלוק שמוזז פחות מזה באותו יום נחשב אותו מקום. */
export const SAME_SLOT_TOLERANCE_MIN = 60;
/** מרחק מינימלי בין שני סידורים (שיעור הבלוקים שבשעה או ביום שונה). מתחתיו מריצים מחדש עם זרע אחר. */
export const MIN_VARIATION_DISTANCE = 0.3;

const keyOf = (b: ScheduleBlock): string => `${b.taskId}#${b.segment ?? 0}`;

/**
 * מדד המרחק בין שני סידורים, 0..1: מתוך בלוקי המשימות הניתנים להזזה (בלי קבועות ושינה),
 * כמה הם ביום שונה או בשעה שונה ביותר משעה. בלוק שקיים רק באחד הסידורים נספר כשונה.
 * `fixedTaskIds` מוציא מהחישוב משימות שלא זזות (הן זהות תמיד ומדללות את המדד).
 */
export function scheduleDistance(a: Schedule, b: Schedule, fixedTaskIds: ReadonlySet<string> = new Set()): number {
  const pick = (s: Schedule): Map<string, ScheduleBlock> =>
    new Map(
      s.blocks
        .filter((x) => x.kind === 'task' && x.taskId !== undefined && !x.locked && !fixedTaskIds.has(x.taskId))
        .map((x) => [keyOf(x), x]),
    );
  const ma = pick(a);
  const mb = pick(b);
  const keys = new Set([...ma.keys(), ...mb.keys()]);
  if (keys.size === 0) return 0;
  let differ = 0;
  for (const k of keys) {
    const x = ma.get(k);
    const y = mb.get(k);
    if (!x || !y) differ++;
    else if (x.range.date !== y.range.date || Math.abs(x.range.startMin - y.range.startMin) >= SAME_SLOT_TOLERANCE_MIN) differ++;
  }
  return differ / keys.size;
}
