import type { Personality } from '../../contracts';

/** שמות החוקים הרכים. אלה גם המפתחות ב-ScoreBreakdown.penalties. */
export const SOFT_RULES = [
  'loadBalance',
  'breaks',
  'consecutive',
  'preferredWindow',
  'effortOrder',
  'contextSwitch',
  'themeSpread',
  'themeMismatch',
  'repeatSpread',
  'buffer',
  'heavyStreak',
  'earliness',
  'offHours',
] as const;
export type SoftRule = (typeof SOFT_RULES)[number];
export type Weights = Record<SoftRule, number>;

/** שלוש אישיויות: אותו מנוע, משקלים וסדר טיפול אחרים (DESIGN 9.4). */
export const PERSONALITY_WEIGHTS: Record<Personality, Weights> = {
  balanced: {
    loadBalance: 5,
    breaks: 3,
    consecutive: 2,
    preferredWindow: 1.5,
    effortOrder: 1,
    contextSwitch: 0.4,
    themeSpread: 0,
    themeMismatch: 0,
    repeatSpread: 40,
    buffer: 2,
    heavyStreak: 2,
    earliness: 0.05,
    offHours: 30,
  },
  early: {
    loadBalance: 0.3,
    breaks: 1,
    consecutive: 1,
    preferredWindow: 1,
    effortOrder: 0.5,
    contextSwitch: 0.2,
    themeSpread: 0,
    themeMismatch: 0,
    repeatSpread: 40,
    buffer: 0.3,
    heavyStreak: 1,
    earliness: 5,
    offHours: 30,
  },
  themed: {
    loadBalance: 0.4,
    breaks: 1,
    consecutive: 1,
    preferredWindow: 1,
    effortOrder: 0.5,
    contextSwitch: 2,
    themeSpread: 3,
    themeMismatch: 4,
    repeatSpread: 40,
    buffer: 0.8,
    heavyStreak: 1,
    earliness: 0.1,
    offHours: 30,
  },
};

export const PERSONALITIES: readonly Personality[] = ['balanced', 'early', 'themed'];
