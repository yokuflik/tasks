import type { BlockedTime, Category, Id, IsoDate, Minutes, Schedule, Settings, Task, Week } from '../contracts';
import type { PersistResult } from '../storage';
import type { AppServices } from './services';
import type { ShiftInput, TaskForm } from './model';

export type TabId = 'day' | 'week' | 'overview' | 'entry' | 'settings' | 'compare';

export interface AppData {
  settings: Settings;
  categories: Category[];
  tasks: Task[];
  weeks: Week[];
}

export interface BlockedInput {
  title: string;
  date: IsoDate;
  startMin: Minutes;
  endMin: Minutes;
}

/** כל הפעולות שמסכים מפעילים. כל פעולה שומרת באחסון וטוענת מחדש. */
export interface Actions {
  goto(tab: TabId): void;
  setWeekStart(date: IsoDate): void;
  createWeek(): Promise<void>;
  copyFromPreviousWeek(): Promise<void>;
  toggleActiveDate(date: IsoDate): Promise<void>;
  addShift(input: ShiftInput): Promise<void>;
  addTask(form: TaskForm): Promise<void>;
  removeTask(id: Id): Promise<void>;
  addBlocked(input: BlockedInput): Promise<void>;
  removeBlocked(id: Id): Promise<void>;
  importIcs(text: string): Promise<number>;
  generate(): Promise<void>;
  selectSchedule(id: Id): Promise<void>;
  /** מחזיר הודעת שגיאה בעברית כשההזזה נדחתה. */
  moveBlock(blockId: Id, date: IsoDate, startMin: Minutes): Promise<string | undefined>;
  setBlockLocked(blockId: Id, locked: boolean): Promise<void>;
  toggleDone(taskId: Id): Promise<void>;
  exportIcs(): void;
  saveSettings(settings: Settings): Promise<void>;
  saveCategory(category: Category): Promise<void>;
  exportBackup(): Promise<void>;
  importBackup(text: string): Promise<string | undefined>;
  resetAll(): Promise<void>;
}

export interface ScreenProps {
  data: AppData;
  /** תחילת השבוע המוצג. */
  weekStart: IsoDate;
  week: Week | undefined;
  /** משימות השבוע המוצג. */
  tasks: Task[];
  selected: Schedule | undefined;
  today: IsoDate;
  busy: boolean;
  persist: PersistResult | undefined;
  actions: Actions;
  services: AppServices;
}

export type { BlockedTime };
