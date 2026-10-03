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
    bg: '#fdf3f6',
    surface: '#ffffff',
    surfaceRaised: '#fffafb',
    text: '#3b2630',
    textMuted: '#6f5560',
    border: '#f0d3dc',
    primary: '#b0386a',
    onPrimary: '#ffffff',
    focus: '#b0386a',
  },
  dark: {
    bg: '#1c1217',
    surface: '#2a1c23',
    surfaceRaised: '#35242d',
    text: '#fbeef2',
    textMuted: '#d1b3be',
    border: '#4d3641',
    primary: '#f29cbc',
    onPrimary: '#3a0f21',
    focus: '#f29cbc',
  },
};

/** שינה: רצועה כהה ושקטה בשני המצבים. */
export const SLEEP: Record<ThemeMode, TintTokens> = {
  light: { bg: '#2b3452', text: '#e6eaf7', accent: '#a9b6e8' },
  dark: { bg: '#141a2e', text: '#d5dcf5', accent: '#8d9cd6' },
};

/** שבת וחגים: רקעים שונים זה מזה, בלי קשר לצבעי הקטגוריות. */
export const SPECIAL: Record<ThemeMode, Record<SpecialDayKind, TintTokens>> = {
  light: {
    shabbat: { bg: '#ece7f7', text: '#3f2d78', accent: '#6b4fc0' },
    holiday: { bg: '#fde9c8', text: '#6b3d00', accent: '#c06a00' },
    holiday_eve: { bg: '#fff4d6', text: '#664d00', accent: '#b38600' },
    chol_hamoed: { bg: '#dff3e8', text: '#14573a', accent: '#2a9163' },
  },
  dark: {
    shabbat: { bg: '#2a2144', text: '#d9cdf8', accent: '#9d86e6' },
    holiday: { bg: '#4a3210', text: '#ffdca8', accent: '#e8a040' },
    holiday_eve: { bg: '#40380f', text: '#f7e6a0', accent: '#d9b73a' },
    chol_hamoed: { bg: '#163a2a', text: '#bfead3', accent: '#4cc08c' },
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
