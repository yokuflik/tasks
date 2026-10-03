import type { Category, Id, Priority, ScheduleBlock, Settings, Task } from '../../contracts';
import type { Grid } from '../base';
import type { Weights } from './personalities';

/** חתיכה משובצת: מקטע של מופע של משימה. זמנים בדקות מוחלטות מתחילת רשת הזמן. */
export interface Piece {
  /** מזהה הבלוק בסידור. */
  id: Id;
  taskId: Id;
  /** אינדקס מקטע רציף בתוך המשימה (ל-ScheduleBlock.segment). */
  segment: number;
  /** מספר המופע (חזרתיות). מקטעים של אותו מופע חולקים מספר. */
  occurrence: number;
  start: number;
  end: number;
  /** false: קבועה או נעולה, לא זזה. */
  movable: boolean;
}

export interface TaskInfo {
  task: Task;
  category: Category | undefined;
  fixed: boolean;
}

/** כל מה שפונקציית הציון והחיפוש צריכים, קבוע לאורך ריצה אחת. */
export interface Ctx {
  grid: Grid;
  settings: Pick<Settings, 'minBreakMin' | 'maxConsecutiveMin'>;
  weights: Weights;
  info: Map<Id, TaskInfo>;
  /** אינדקסי ימים פעילים בתוך הרשת. */
  activeDays: number[];
  /** דקות פנויות (בתוך חלון פעיל) בכל יום, לפני משימות גמישות. */
  baseFreeMin: number[];
  /** ימי נושא לכל קטגוריה (רק באישיות נושאי יום). */
  themeDays: Map<Id, Set<number>>;
  /** מסכת מגבלות לכל משימה גמישה (1 = מותר). */
  masks: Map<Id, Uint8Array>;
  /** ריפוד נסיעה לכל כיוון (דקות, מעוגל למשבצות) לכל משימה. */
  pads: Map<Id, number>;
  /** סדר עדיפות מספרי. */
  priorityWeight: Record<Priority, number>;
}

export interface PlanResultBlocks {
  blocks: ScheduleBlock[];
}
