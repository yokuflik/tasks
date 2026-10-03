/**
 * חוזים משותפים (P0). טיפוסים וקבועים בלבד, בלי לוגיקה.
 * נעולים אחרי P0: שינוי רק דרך חלון אחד ובאישור המשתמש.
 *
 * מוסכמות זמן:
 * - IsoDate: "YYYY-MM-DD" בשעון מקומי (Settings.timeZone), ללא שעה.
 * - Minutes: דקות מחצות של IsoDate, בשעון קיר (wall clock). 0..1440.
 * - טווח שחוצה חצות: endMin גדול מ-1440 (עד 2880) על אותו date של ההתחלה.
 * - ביום מעבר שעון, מחשבים לפי שעון קיר. התאמה בפועל היא באחריות P2.
 */

export const CONTRACT_VERSION = 1;
/** גודל משבצת במנוע השיבוץ. */
export const GRID_MINUTES = 15;
export const MAX_CATEGORIES = 11;
/** 0 = יום ראשון. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEK_START: Weekday = 0;

export type Id = string;
export type IsoDate = string;
export type Minutes = number;

export interface TimeRange {
  date: IsoDate;
  startMin: Minutes;
  /** גדול מ-startMin. עד 2880 כשחוצה חצות. */
  endMin: Minutes;
}

export interface TimeWindow {
  startMin: Minutes;
  endMin: Minutes;
}

export type Priority = 'low' | 'medium' | 'high';
/** fixed = לא זז (משמרת עבודה). */
export type Flexibility = 'fixed' | 'semi' | 'flexible';
export type Effort = 'heavy' | 'medium' | 'light';
export type TaskStatus = 'pending' | 'scheduled' | 'done' | 'postponed';

export interface Category {
  id: Id;
  name: string;
  color: string;
  icon: string;
  /** קטגוריה קבועה: משימותיה אינן זזות. כרגע רק עבודה. */
  fixed: boolean;
  preferredWindow?: TimeWindow;
  dailyCapMin?: Minutes;
  canCombine: boolean;
}

export interface TaskConstraints {
  /** יום קבוע. */
  fixedDate?: IsoDate;
  /** שעת התחלה קבועה. */
  fixedStartMin?: Minutes;
  allowedWindow?: TimeWindow;
  forbiddenWeekdays?: Weekday[];
  forbiddenWindows?: TimeWindow[];
}

export interface TaskSplit {
  splittable: boolean;
  minSegmentMin?: Minutes;
}

export interface Task {
  id: Id;
  title: string;
  notes?: string;
  categoryId: Id;
  durationMin: Minutes;
  /** נסיעה לכל כיוון (דקות), מחוץ למשך. עבודה: תמיד 20. */
  travelMin?: Minutes;
  priority: Priority;
  dueDate?: IsoDate;
  weekId?: Id;
  constraints: TaskConstraints;
  flexibility: Flexibility;
  split: TaskSplit;
  /** המשימה חייבת לבוא אחרי כולן. */
  dependsOn: Id[];
  effort: Effort;
  /** חזרתיות: כמה מופעים בשבוע. 1 = רגיל. */
  timesPerWeek: number;
  status: TaskStatus;
}

export interface BlockedTime {
  id: Id;
  title: string;
  range: TimeRange;
  source: 'manual' | 'ics';
}

export type BlockKind = 'task' | 'sleep';

export interface ScheduleBlock {
  id: Id;
  kind: BlockKind;
  /** חובה כש-kind הוא task. */
  taskId?: Id;
  /** אינדקס מקטע (מ-0) כשהמשימה פוצלה או חוזרת. */
  segment?: number;
  range: TimeRange;
  /** ננעל ידנית: השיבוץ מחדש לא נוגע בו. */
  locked: boolean;
}

export type UnplacedReason =
  | 'not_enough_time'
  | 'deadline_conflict'
  | 'larger_than_any_window'
  | 'forbidden_time'
  | 'fixed_conflict'
  | 'circular_dependency'
  | 'dependency_unplaced'
  | 'would_break_sleep';

export interface UnplacedTask {
  taskId: Id;
  reason: UnplacedReason;
  /** משימות קשורות (למשל מעגל התלות). */
  relatedTaskIds?: Id[];
  /** הצעה מה אפשר לפנות, בעברית. */
  suggestion?: string;
}

/** לילה שבו אי אפשר לשמור שינה רציפה במינימום הנדרש. */
export interface SleepShortfall {
  /** התאריך שבו הלילה מתחיל. */
  date: IsoDate;
  availableMin: Minutes;
  requiredMin: Minutes;
}

export interface ExceptionsReport {
  unplaced: UnplacedTask[];
  sleepShortfalls: SleepShortfall[];
}

export interface ScoreBreakdown {
  total: number;
  placedCount: number;
  totalCount: number;
  breaksKept: number;
  maxDayLoadMin: Minutes;
  /** קנס לכל חוק רך, לפי שם החוק. */
  penalties: Record<string, number>;
}

export type Personality = 'balanced' | 'early' | 'themed';

export interface Schedule {
  id: Id;
  personality: Personality;
  /** זרע דטרמיניסטי: אותו קלט ואותו זרע נותנים אותה תוצאה. */
  seed: number;
  score: ScoreBreakdown;
  blocks: ScheduleBlock[];
  exceptions: ExceptionsReport;
}

export interface Week {
  id: Id;
  /** תאריך יום ראשון. */
  startDate: IsoDate;
  /** ימים פעילים לתכנון. */
  activeDates: IsoDate[];
  /** חלון פעיל לכל יום. חסר = כל היום זמין והמנוע קובע שינה בעצמו. */
  dayWindows?: Record<IsoDate, TimeWindow>;
  blockedTimes: BlockedTime[];
  taskIds: Id[];
  schedules: Schedule[];
  selectedScheduleId?: Id;
}

export type SpecialDayKind = 'shabbat' | 'holiday' | 'holiday_eve' | 'chol_hamoed';

/** סימון להצגה בלבד. אינו משפיע על שיבוץ. */
export interface SpecialDay {
  date: IsoDate;
  kind: SpecialDayKind;
  name: string;
  hebrewDate: string;
  parasha?: string;
}

export interface Settings {
  timeZone: string;
  /** מינימום ויעד לשינה רציפה. חוק קשיח. אין שעות שינה ברירת מחדל. */
  minSleepMin: Minutes;
  targetSleepMin: Minutes;
  minBreakMin: Minutes;
  maxConsecutiveMin?: Minutes;
  warnOnSpecialDays: boolean;
  lastBackupAt?: string;
  schemaVersion: number;
}
