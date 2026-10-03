import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const html = read('index.html');

function pngInfo(path: string) {
  const b = readFileSync(join(root, path));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

describe('manifest', () => {
  it('מכיל את כל השדות החובה', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThan(12);
    expect(manifest.description).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.lang).toBe('he');
    expect(manifest.dir).toBe('rtl');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBeTruthy();
  });

  it('כולל אייקונים 192, 512 ו-maskable שקיימים בגודל הנכון', () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; type: string; purpose: string }>;
    for (const size of ['192x192', '512x512']) {
      expect(icons.some((i) => i.sizes === size && i.purpose === 'any')).toBe(true);
    }
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const i of icons) {
      const { width, height } = pngInfo(`public/${i.src}`);
      expect(`${width}x${height}`).toBe(i.sizes);
    }
  });

  it('apple-touch-icon הוא 180x180 בלי שקיפות', () => {
    const info = pngInfo('public/icons/apple-touch-icon.png');
    expect([info.width, info.height]).toEqual([180, 180]);
    expect(info.colorType).toBe(2); // RGB, בלי alpha
  });
});

describe('index.html', () => {
  const metaNames = [
    'apple-mobile-web-app-capable',
    'mobile-web-app-capable',
    'apple-mobile-web-app-status-bar-style',
    'apple-mobile-web-app-title',
  ];
  it.each(metaNames)('מכיל meta %s', (name) => {
    expect(html).toMatch(new RegExp(`<meta name="${name}" content="[^"]+"`));
  });
  it('מכיל viewport-fit=cover, theme-color לבהיר ולכהה, manifest ו-apple-touch-icon', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toMatch(/theme-color"[^>]*prefers-color-scheme: light/);
    expect(html).toMatch(/theme-color"[^>]*prefers-color-scheme: dark/);
    expect(html).toMatch(/rel="manifest" href="\.\/manifest\.webmanifest"/);
    expect(html).toMatch(/rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png"/);
  });
  it('כל תמונות מסך הכניסה קיימות ובגודל שמתאים לשם ולמדיה', () => {
    const links = [...html.matchAll(/<link rel="apple-touch-startup-image" href="([^"]+)" media="([^"]+)"/g)];
    expect(links.length).toBeGreaterThanOrEqual(12);
    for (const [, href, media] of links) {
      const { width, height } = pngInfo(`public/${href!.replace('./', '')}`);
      const dw = Number(/device-width: (\d+)px/.exec(media!)![1]);
      const dh = Number(/device-height: (\d+)px/.exec(media!)![1]);
      const ratio = Number(/pixel-ratio: (\d)/.exec(media!)![1]);
      expect([width, height]).toEqual([dw * ratio, dh * ratio]);
    }
  });
});

describe('נתיבים ובקשות רשת', () => {
  const pwaSources = readdirSync(join(root, 'src/pwa'))
    .filter((f) => statSync(join(root, 'src/pwa', f)).isFile())
    .map((f) => `src/pwa/${f}`);
  const files = ['index.html', 'public/manifest.webmanifest', ...pwaSources];

  it('אף נתיב לא מקבע את שם המאגר ואין נתיבי שורש מוחלטים', () => {
    for (const f of files) expect(read(f), f).not.toMatch(/expenses/i);
    for (const k of ['start_url', 'scope', 'id']) expect(manifest[k]).toMatch(/^\.\//);
    for (const i of manifest.icons) expect(i.src).not.toMatch(/^\/|^https?:/);
    for (const [, v] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (v!.startsWith('/src/')) continue; // נקודות כניסה של Vite, מתורגמות לנתיב יחסי בבנייה
      expect(v, v).not.toMatch(/^\/|^[a-z]+:/i);
    }
  });

  it('אין בקשת רשת חיצונית בקוד, ב-HTML ובמניפסט', () => {
    for (const f of files) {
      const text = read(f);
      expect(text, f).not.toMatch(/https?:\/\//);
      expect(text, f).not.toMatch(/\b(XMLHttpRequest|WebSocket|sendBeacon)\b/);
    }
  });
});
