import type { SpecialDayKind } from '../contracts';
import { mix } from './color';

/** מקור אמת יחיד לצבעים. ה-CSS נוצר מכאן ב-themeCss(), והטסטים בודקים ניגודיות על אותם ערכים. */

export type ThemeMode = 'light' | 'dark';

export interface SurfaceTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  focus: string;
}

export interface TintTokens {
  bg: string;
  text: string;
  /** צבע מבטא לקווים ואייקונים (ניגודיות לרכיב לא טקסטואלי). */
  accent: string;
}

export const SURFACES: Record<ThemeMode, SurfaceTokens> = {
  light: {
    bg: '#ffeef4',
    surface: '#ffffff',
    surfaceRaised: '#fff5f8',
    text: '#3b2630',
    textMuted: '#6f5560',
    border: '#f6c6d8',
    primary: '#c2185b',
    onPrimary: '#ffffff',
    focus: '#c2185b',
  },
  dark: {
    bg: '#220d16',
    surface: '#341522',
    surfaceRaised: '#431b2d',
    text: '#fbeef2',
    textMuted: '#d1b3be',
    border: '#6a2b45',
    primary: '#ff9ec4',
    onPrimary: '#3a0f21',
    focus: '#ff9ec4',
  },
};

/** שינה: רצועה כהה ושקטה בשני המצבים. */
export const SLEEP: Record<ThemeMode, TintTokens> = {
  light: { bg: '#4a2340', text: '#fbe6f1', accent: '#f0a6cb' },
  dark: { bg: '#2a1124', text: '#f7d9e8', accent: '#d98bb4' },
};

/** שבת וחגים: רקעים שונים זה מזה, בלי קשר לצבעי הקטגוריות. */
export const SPECIAL: Record<ThemeMode, Record<SpecialDayKind, TintTokens>> = {
  light: {
    shabbat: { bg: '#f6e3f3', text: '#6a1f66', accent: '#a23a9c' },
    holiday: { bg: '#ffe0e0', text: '#7a1f2e', accent: '#c93a50' },
    holiday_eve: { bg: '#ffeadb', text: '#7a3a1c', accent: '#c4622e' },
    chol_hamoed: { bg: '#fbdcec', text: '#7a1f55', accent: '#c2307f' },
  },
  dark: {
    shabbat: { bg: '#3d1a3a', text: '#f5d3f1', accent: '#d27acb' },
    holiday: { bg: '#4a1a24', text: '#ffd2d8', accent: '#f0707f' },
    holiday_eve: { bg: '#4a2a1c', text: '#ffdcc8', accent: '#eb9068' },
    chol_hamoed: { bg: '#471a38', text: '#ffd0e8', accent: '#ee6fb0' },
  },
};

/**
 * גוונים לקטגוריה מתוך צבע הבסיס שלה (גם כשהמשתמש משנה צבע).
 * בהיר: רקע בהיר וטקסט כהה. כהה: רקע כהה וטקסט בהיר.
 */
export function categoryTint(baseColor: string, mode: ThemeMode): TintTokens {
  if (mode === 'light') {
    return {
      bg: mix(baseColor, '#ffffff', 0.84),
      text: mix(baseColor, '#000000', 0.62),
      accent: mix(baseColor, '#000000', 0.18),
    };
  }
  return {
    bg: mix(baseColor, '#101012', 0.72),
    text: mix(baseColor, '#ffffff', 0.8),
    accent: mix(baseColor, '#ffffff', 0.3),
  };
}

const SPECIAL_KINDS: SpecialDayKind[] = ['shabbat', 'holiday', 'holiday_eve', 'chol_hamoed'];

function modeVars(mode: ThemeMode): string {
  const s = SURFACES[mode];
  const lines = [
    `--bg:${s.bg}`, `--surface:${s.surface}`, `--surface-raised:${s.surfaceRaised}`,
    `--text:${s.text}`, `--text-muted:${s.textMuted}`, `--border:${s.border}`,
    `--primary:${s.primary}`, `--on-primary:${s.onPrimary}`, `--focus:${s.focus}`,
    `--sleep-bg:${SLEEP[mode].bg}`, `--sleep-text:${SLEEP[mode].text}`, `--sleep-accent:${SLEEP[mode].accent}`,
  ];
  for (const kind of SPECIAL_KINDS) {
    const t = SPECIAL[mode][kind];
    lines.push(`--${kind}-bg:${t.bg}`, `--${kind}-text:${t.text}`, `--${kind}-accent:${t.accent}`);
  }
  return lines.join(';');
}

/** משתני CSS לשני המצבים. כהה אוטומטי לפי המכשיר, ואפשר לכפות עם data-theme. */
export function themeCss(): string {
  return [
    `:root{color-scheme:light dark;${modeVars('light')}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${modeVars('dark')}}}`,
    `:root[data-theme="dark"]{color-scheme:dark;${modeVars('dark')}}`,
    `:root[data-theme="light"]{color-scheme:light}`,
  ].join('\n');
}

/** משתני צבע של קטגוריה בשני המצבים; ה-CSS בוחר לפי מצב. */
export function categoryStyleVars(baseColor: string): Record<string, string> {
  const l = categoryTint(baseColor, 'light');
  const d = categoryTint(baseColor, 'dark');
  return {
    '--cl-bg': l.bg, '--cl-text': l.text, '--cl-accent': l.accent,
    '--cd-bg': d.bg, '--cd-text': d.text, '--cd-accent': d.accent,
  };
}

/** מזריק את משתני הצבע לדף. אידמפוטנטי. */
export function installTheme(doc: Document = document): void {
  const id = 'planner-theme-vars';
  let el = doc.getElementById(id);
  if (!el) {
    el = doc.createElement('style');
    el.id = id;
    doc.head.appendChild(el);
  }
  el.textContent = themeCss();
}
