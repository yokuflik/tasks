import type { Category, ExceptionsReport, IsoDate, Settings, SpecialDay, Task, Week } from './index';

/** תרחיש בדיקה משותף: קלט מלא למנוע, ותוצאות צפויות לפי חוקים. */
export interface ScenarioExpectation {
  /** משימות שחייבות להופיע בדוח החריגים עם הסיבה. */
  unplaced?: ExceptionsReport['unplaced'];
  /** לילות שחייבים להופיע כחסרי שינה מספקת. */
  sleepShortfallDates?: IsoDate[];
  /** לפחות כמה משימות חייבות להיכשל בשיבוץ (למשל שבוע עמוס מדי). */
  minUnplacedCount?: number;
  /** משימות שחייבות להיות משובצות (בכל וריאציה). */
  placedTaskIds?: string[];
  /** כל תאריך שמצופה להיות מסומן כיום מיוחד, לפי P2. */
  specialDates?: IsoDate[];
  /** כשנכון: המנוע חייב לעצור ולדווח, לא להיתקע. */
  mustTerminateWithReport?: boolean;
}

export interface Scenario {
  name: string;
  description: string;
  settings: Settings;
  categories: Category[];
  tasks: Task[];
  /** שבוע ללא סידורים. */
  week: Week;
  specialDays: SpecialDay[];
  expect: ScenarioExpectation;
}
