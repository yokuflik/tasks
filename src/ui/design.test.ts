import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../contracts/defaults';
import type { SpecialDayKind } from '../contracts';
import { contrastRatio } from './color';
import { formatDuration, formatRange, formatTime } from './format';
import { SLEEP, SPECIAL, SURFACES, categoryTint, themeCss, type ThemeMode } from './tokens';

const MODES: ThemeMode[] = ['light', 'dark'];
const KINDS: SpecialDayKind[] = ['shabbat', 'holiday', 'holiday_eve', 'chol_hamoed'];

describe('ניגודיות צבעים (WCAG)', () => {
  it('מחשבון הניגודיות נכון', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  describe.each(MODES)('מצב %s', (mode) => {
    const s = SURFACES[mode];
    it('טקסט ראשי ומשני על הרקעים: לפחות 4.5', () => {
      for (const bg of [s.bg, s.surface, s.surfaceRaised]) {
        expect(contrastRatio(s.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(s.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('כפתור ראשי, קישור וטבעת פוקוס', () => {
      expect(contrastRatio(s.onPrimary, s.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(s.primary, s.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(s.focus, s.bg)).toBeGreaterThanOrEqual(3);
    });
    it('רצועת שינה', () => {
      expect(contrastRatio(SLEEP[mode].text, SLEEP[mode].bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(SLEEP[mode].accent, SLEEP[mode].bg)).toBeGreaterThanOrEqual(3);
    });
    it.each(KINDS)('שבת וחגים: %s', (kind) => {
      const t = SPECIAL[mode][kind];
      expect(contrastRatio(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
    });
    it.each(DEFAULT_CATEGORIES.map((c) => [c.id, c.color] as const))('קטגוריה %s', (_id, color) => {
      const t = categoryTint(color, mode);
      expect(contrastRatio(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
      // קו מסגרת ואייקון על הרקע של הכרטיס ועל רקע הדף
      expect(contrastRatio(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.accent, s.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.accent, s.surface)).toBeGreaterThanOrEqual(3);
    });
  });

  it('צבע שהמשתמש בוחר (בהיר מאוד וכהה מאוד) עדיין קריא', () => {
    for (const color of ['#ffff00', '#000000', '#ffffff', '#00ff00', '#0000ff']) {
      for (const mode of MODES) {
        const t = categoryTint(color, mode);
        expect(contrastRatio(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('אחת-עשרה קטגוריות נבדלות זו מזו בבהיר (גוון מבטא)', () => {
    const accents = DEFAULT_CATEGORIES.map((c) => categoryTint(c.color, 'light').accent);
    expect(new Set(accents).size).toBe(11);
  });

  it('רקעי שבת, חג, ערב חג וחול המועד שונים זה מזה', () => {
    for (const mode of MODES) {
      expect(new Set(KINDS.map((k) => SPECIAL[mode][k].bg)).size).toBe(KINDS.length);
    }
  });
});

describe('CSS', () => {
  const css = readFileSync(join(__dirname, 'theme.css'), 'utf8');

  it('כיווניות: רק מאפיינים לוגיים, בלי left/right פיזיים', () => {
    const physical = /(margin|padding|border)-(left|right)|(^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)|float\s*:\s*(left|right)|border-(top|bottom)-(left|right)-radius/m;
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(physical);
    expect(stripped).toMatch(/padding-inline/);
  });

  it('אזורים בטוחים בכל ארבעת הצדדים', () => {
    for (const side of ['top', 'bottom', 'right', 'left']) expect(css).toContain(`safe-area-inset-${side}`);
  });

  it('תמיכה בהפחתת תנועה ואנימציות קצרות', () => {
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toMatch(/--dur:\s*\d{2,3}ms/);
    const ms = Number(/--dur:\s*(\d+)ms/.exec(css)![1]);
    expect(ms).toBeLessThanOrEqual(250);
  });

  it('כל המשתנים ש-CSS משתמש בהם מוגדרים (בטוקנים או ב-CSS)', () => {
    const generated = themeCss();
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g), ...generated.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
    // משתני קטגוריה מוזרקים בקו ישיר ברכיב
    ['--cl-bg', '--cl-text', '--cl-accent', '--cd-bg', '--cd-text', '--cd-accent'].forEach((v) => defined.add(v));
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });

  it('themeCss: בהיר ברירת מחדל, כהה לפי מכשיר, וכפייה ידנית', () => {
    const out = themeCss();
    expect(out).toContain('prefers-color-scheme: dark');
    expect(out).toContain('[data-theme="dark"]');
    expect(out).toContain(`--bg:${SURFACES.light.bg}`);
    expect(out).toContain(`--bg:${SURFACES.dark.bg}`);
  });

  it('אין בקשת רשת חיצונית (פונטים, תמונות) בקבצי העיצוב', () => {
    for (const f of readdirSync(__dirname).filter((n) => /\.(css|tsx?)$/.test(n) && !n.includes('.test.'))) {
      expect(readFileSync(join(__dirname, f), 'utf8'), f).not.toMatch(/https?:\/\//);
    }
  });
});

describe('עיצוב זמן', () => {
  it('שעה בשעון קיר, כולל חציית חצות', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(545)).toBe('09:05');
    expect(formatTime(1440 + 90)).toBe('01:30');
    expect(formatRange(1320, 1440 + 360)).toBe('22:00–06:00');
  });
  it('משך בעברית', () => {
    expect(formatDuration(45)).toBe('45 ד׳');
    expect(formatDuration(60)).toBe('שעה');
    expect(formatDuration(120)).toBe('2 ש׳');
    expect(formatDuration(150)).toBe('2 ש׳ 30 ד׳');
  });
});
