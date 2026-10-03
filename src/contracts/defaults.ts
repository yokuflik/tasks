import type { Category, Settings } from './index';
import { CONTRACT_VERSION } from './index';

/** 11 קטגוריות ברירת מחדל. עבודה היא הקבועה היחידה. צבעים סופיים ב-P6. */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'date', name: 'דייט', color: '#e91e63', icon: '❤️', fixed: false, canCombine: false },
  { id: 'work', name: 'עבודה', color: '#c2185b', icon: 'briefcase', fixed: true, canCombine: false },
  { id: 'study', name: 'לימודים', color: '#9c3d9e', icon: 'book', fixed: false, canCombine: false },
  { id: 'fitness', name: 'אימונים', color: '#f06277', icon: 'dumbbell', fixed: false, canCombine: true },
  { id: 'health', name: 'בריאות', color: '#d9577f', icon: 'heart', fixed: false, canCombine: true },
  { id: 'errands', name: 'סידורים', color: '#e8907a', icon: 'bag', fixed: false, canCombine: true },
  { id: 'home', name: 'בית ותחזוקה', color: '#a8506b', icon: 'home', fixed: false, canCombine: true },
  { id: 'family', name: 'משפחה', color: '#ec407a', icon: 'people', fixed: false, canCombine: true },
  { id: 'friends', name: 'חברים וחברה', color: '#c06bb5', icon: 'chat', fixed: false, canCombine: true },
  { id: 'leisure', name: 'פנאי ותחביבים', color: '#e08a58', icon: 'palette', fixed: false, canCombine: true },
  { id: 'personal', name: 'אישי ומנוחה', color: '#8e5a7a', icon: 'moon', fixed: false, canCombine: true },
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
