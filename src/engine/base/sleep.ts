import { GRID_MINUTES } from '../../contracts';
import type { IsoDate, ScheduleBlock, Settings, SleepShortfall } from '../../contracts';
import { addDays, dayDiff } from './dates';
import { absToRange, freeRuns, occupy, OCCUPANT, rangeToAbs } from './grid';
import type { Grid } from './grid';

/**
 * "לילה D" הוא הלילה שבין D ל-D+1. העוגן והטווח משמשים רק לשיוך בלוק שינה ללילה.
 * מיקום השינה: מ-23:00 (העדפת המשתמש), ואם משמרת לילה תופסת את הלילה, מיד אחריה.
 * שינה של לילה D חייבת להתחיל בתוך [עוגן - חצי טווח, עוגן + חצי טווח), כלומר בין 18:00 ל-12:00 למחרת.
 * היא רשאית להימשך אחרי החלון, וגם לחרוג מחלון הפעילות היומי (BUILD_PLAN סעיף 13).
 */
export const NIGHT_ANCHOR_MIN = 1440 + 180;
/** העדפת המשתמש: בלי משמרת או משימה שמפריעות, השינה מתחילה ב-23:00. */
export const PREFERRED_SLEEP_START_MIN = 23 * 60;
export const NIGHT_HALF_SPAN_MIN = 540;

export interface NightWindow {
  startAbs: number;
  endAbs: number;
  anchorAbs: number;
}

export function nightWindow(grid: Grid, date: IsoDate): NightWindow {
  const anchorAbs = dayDiff(grid.originDate, date) * 1440 + NIGHT_ANCHOR_MIN;
  return { startAbs: anchorAbs - NIGHT_HALF_SPAN_MIN, endAbs: anchorAbs + NIGHT_HALF_SPAN_MIN, anchorAbs };
}

export interface SleepPlan {
  blocks: ScheduleBlock[];
  shortfalls: SleepShortfall[];
}

/**
 * מניח בלוק שינה רציף אחד לכל לילה של ימים פעילים, לפני כל משימה גמישה.
 * - מועמדים: רצפי זמן פנוי (בלי תלות בחלון הפעילות) שאפשר להתחיל בהם שינה בתוך חלון הלילה.
 * - דרגות: לפחות היעד, לפחות המינימום, פחות. בתוך דרגה מצליחה, ההתחלה הקרובה ל-23:00.
 *   בדרגה הכושלת: הארוך ביותר.
 * - אין מקום למינימום: מניחים את מה שיש (אם יש) ומדווחים SleepShortfall. לא שוברים את הכלל בשקט.
 * - שינה נעולה (lockedBlocks) נשמרת; אם קצרה מהמינימום מדווחים.
 * בלוק שינה מקבל את תאריך ההתחלה שלו (יכול להיות D+1).
 */
export function planSleep(
  grid: Grid,
  activeDates: readonly IsoDate[],
  settings: Pick<Settings, 'minSleepMin' | 'targetSleepMin'>,
  lockedBlocks: readonly ScheduleBlock[] = [],
  /** התחלות (מוחלטות) של משמרות בוקר כולל נסיעה: השינה מסתיימת בדיוק בהן. */
  morningStarts: readonly number[] = [],
): SleepPlan {
  const min = settings.minSleepMin;
  const target = Math.max(settings.targetSleepMin, min);
  const blocks: ScheduleBlock[] = [];
  const shortfalls: SleepShortfall[] = [];
  const lockedSleeps = lockedBlocks.filter((b) => b.kind === 'sleep').map((b) => rangeToAbs(grid, b.range));

  const sortedDates = [...activeDates].sort();
  // הלילה שלפני היום הראשון בשבוע נמצא לפני הרשת. אם יש משמרת בוקר ביום הראשון, השינה שלה נשמרת (נגמרת בנסיעה).
  const first = sortedDates[0];
  if (first !== undefined && dayDiff(grid.originDate, first) === 0) {
    const m = morningStarts.filter((x) => x >= 0 && x < 720).sort((a, b) => a - b)[0];
    if (m !== undefined) {
      // לפני תחילת הרשת הכל פנוי; בתוכה השינה נעצרת בתפוסה הקרובה.
      const run = freeRuns(grid, { ignoreOpen: true }).find((r) => r.end === m);
      let start = run ? m - target : m;
      if (run && run.start > 0) start = Math.max(start, run.start);
      if (m - start > 0) {
        occupy(grid, start, m, OCCUPANT.sleep);
        const range = absToRange(grid, start, m);
        blocks.push({ id: `sleep-${addDays(first, -1)}`, kind: 'sleep', range, locked: false });
      }
    }
  }

  for (const date of sortedDates) {
    const win = nightWindow(grid, date);
    const locked = lockedSleeps.filter((r) => r.start >= win.startAbs && r.start < win.endAbs);
    if (locked.length > 0) {
      const longest = Math.max(...locked.map((r) => r.end - r.start));
      if (longest < min) shortfalls.push({ date, availableMin: longest, requiredMin: min });
      continue;
    }

    const prefStart = dayDiff(grid.originDate, date) * 1440 + PREFERRED_SLEEP_START_MIN;
    let best: { start: number; len: number; tier: number; dist: number; avail: number } | null = null;
    // משמרת בוקר: השינה מודבקת אליה (נגמרת ברגע שהנסיעה מתחילה), גם אם זה מקדים את 23:00.
    const morning = morningStarts
      .filter((m) => m >= win.anchorAbs - 180 + 240 && m < win.endAbs)
      .sort((a, b) => a - b)[0];
    if (morning !== undefined) {
      const run = freeRuns(grid, { ignoreOpen: true }).find((r) => r.end === morning && r.end > win.startAbs);
      const s0 = run ? Math.max(run.start, win.startAbs) : 0;
      if (run && morning - s0 >= min) {
        const len = Math.min(target, morning - s0);
        occupy(grid, morning - len, morning, OCCUPANT.sleep);
        blocks.push({
          id: `sleep-${date}`,
          kind: 'sleep',
          range: absToRange(grid, morning - len, morning),
          locked: false,
        });
        continue;
      }
    }
    for (const run of freeRuns(grid, { ignoreOpen: true })) {
      const s0 = Math.max(run.start, win.startAbs);
      if (s0 >= Math.min(run.end, win.endAbs)) continue;
      const avail = run.end - s0;
      // מתחילים ב-23:00, או מיד כשהזמן מתפנה (למשל אחרי משמרת לילה). אם אין מקום למינימום, מקדימים.
      const ideal = Math.min(Math.max(s0, prefStart), win.endAbs - GRID_MINUTES);
      const fromIdeal = run.end - ideal;
      const len = fromIdeal >= min ? Math.min(target, fromIdeal) : Math.min(target, avail);
      const start = fromIdeal >= min ? ideal : run.end - len;
      const tier = len >= target ? 2 : len >= min ? 1 : 0;
      const dist = Math.abs(start - prefStart);
      const better =
        !best ||
        tier > best.tier ||
        (tier === best.tier &&
          (tier === 0
            ? avail > best.avail || (avail === best.avail && dist < best.dist)
            : dist < best.dist || (dist === best.dist && start < best.start)));
      if (better) best = { start, len, tier, dist, avail };
    }

    if (!best) {
      shortfalls.push({ date, availableMin: 0, requiredMin: min });
      continue;
    }
    occupy(grid, best.start, best.start + best.len, OCCUPANT.sleep);
    blocks.push({
      id: `sleep-${date}`,
      kind: 'sleep',
      range: absToRange(grid, best.start, best.start + best.len),
      locked: false,
    });
    if (best.tier === 0) shortfalls.push({ date, availableMin: best.avail, requiredMin: min });
  }
  return { blocks, shortfalls };
}
