import type { Category, Settings } from './index';
import { CONTRACT_VERSION } from './index';

/** 10 קטגוריות ברירת מחדל. עבודה היא הקבועה היחידה. צבעים סופיים ב-P6. */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'work', name: 'עבודה', color: '#3b6fd4', icon: 'briefcase', fixed: true, canCombine: false },
  { id: 'study', name: 'לימודים', color: '#7a54c8', icon: 'book', fixed: false, canCombine: false },
  { id: 'fitness', name: 'אימונים', color: '#e0662f', icon: 'dumbbell', fixed: false, canCombine: true },
  { id: 'health', name: 'בריאות', color: '#2f9e73', icon: 'heart', fixed: false, canCombine: true },
  { id: 'errands', name: 'סידורים', color: '#c79a1d', icon: 'bag', fixed: false, canCombine: true },
  { id: 'home', name: 'בית ותחזוקה', color: '#8a6d4f', icon: 'home', fixed: false, canCombine: true },
  { id: 'family', name: 'משפחה', color: '#d6478c', icon: 'people', fixed: false, canCombine: true },
  { id: 'friends', name: 'חברים וחברה', color: '#1f9fb5', icon: 'chat', fixed: false, canCombine: true },
  { id: 'leisure', name: 'פנאי ותחביבים', color: '#a3b11f', icon: 'palette', fixed: false, canCombine: true },
  { id: 'personal', name: 'אישי ומנוחה', color: '#6b7a90', icon: 'moon', fixed: false, canCombine: true },
];

/** ערכי חוקים בלבד. בכוונה אין כאן שעות שינה. */
export const DEFAULT_SETTINGS: Settings = {
  timeZone: 'Asia/Jerusalem',
  minSleepMin: 480,
  targetSleepMin: 540,
  minBreakMin: 15,
  warnOnSpecialDays: false,
  schemaVersion: CONTRACT_VERSION,
};
