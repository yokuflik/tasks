import { GRID_MINUTES } from '../../contracts';
import type { IsoDate, ScheduleBlock, Settings, SleepShortfall } from '../../contracts';
import { dayDiff } from './dates';
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
): SleepPlan {
  const min = settings.minSleepMin;
  const target = Math.max(settings.targetSleepMin, min);
  const blocks: ScheduleBlock[] = [];
  const shortfalls: SleepShortfall[] = [];
  const lockedSleeps = lockedBlocks.filter((b) => b.kind === 'sleep').map((b) => rangeToAbs(grid, b.range));

  for (const date of [...activeDates].sort()) {
    const win = nightWindow(grid, date);
    const locked = lockedSleeps.filter((r) => r.start >= win.startAbs && r.start < win.endAbs);
    if (locked.length > 0) {
      const longest = Math.max(...locked.map((r) => r.end - r.start));
      if (longest < min) shortfalls.push({ date, availableMin: longest, requiredMin: min });
      continue;
    }

    const prefStart = dayDiff(grid.originDate, date) * 1440 + PREFERRED_SLEEP_START_MIN;
    let best: { start: number; len: number; tier: number; dist: number; avail: number } | null = null;
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
