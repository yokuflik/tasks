import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildServiceWorker } from '../../src/pwa/build';

const template = readFileSync(new URL('../../src/pwa/sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://example.github.io/some-repo/';

type Handler = (e: Record<string, unknown>) => void;

/** סביבת SW מדומה: מטמונים בזיכרון ו"רשת" שאפשר לכבות. */
function createSw(files: Record<string, string>, store = new Map<string, Map<string, string>>()) {
  const handlers = new Map<string, Handler>();
  const network = { online: true, requests: [] as string[] };
  let skipped = false;
  const abs = (u: string) => new URL(u, SCOPE).href;
  const makeCache = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      addAll: async (urls: string[]) => {
        for (const u of urls) {
          if (!network.online) throw new Error('offline');
          m.set(u, `body:${u}`);
        }
      },
      match: async (req: string | { url: string }) => {
        const key = typeof req === 'string' ? req : req.url;
        const hit = m.get(key.split('?')[0]!);
        return hit === undefined ? undefined : { body: hit };
      },
    };
  };
  const sandbox = {
    URL,
    self: {
      registration: { scope: SCOPE },
      clients: { claim: async () => {} },
      skipWaiting: () => {
        skipped = true;
      },
      addEventListener: (t: string, h: Handler) => handlers.set(t, h),
      fetch: async (req: { url: string }) => {
        network.requests.push(req.url);
        if (!network.online) throw new Error('offline');
        return { body: `net:${req.url}` };
      },
    },
    caches: {
      open: async (n: string) => makeCache(n),
      keys: async () => [...store.keys()],
      delete: async (n: string) => store.delete(n),
    },
  };
  vm.runInNewContext(buildServiceWorker(template, files), sandbox);
  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let p: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({
      waitUntil: (x: Promise<unknown>) => (p = x),
      respondWith: (x: Promise<unknown>) => (p = x),
      ...extra,
    });
    return p;
  };
  const req = (path: string, extra: Record<string, unknown> = {}) => ({
    method: 'GET',
    mode: 'cors',
    url: abs(path),
    ...extra,
  });
  return { run, req, network, store, wasSkipped: () => skipped };
}

const files = { 'index.html': '<html>', 'assets/app-abc.js': 'js', 'icons/icon-192.png': 'png' };

describe('Service Worker', () => {
  it('שומר מראש את כל הקבצים בהתקנה, ביחס לתחום הרישום', async () => {
    const sw = createSw(files);
    await sw.run('install');
    const [cache] = [...sw.store.values()];
    expect([...cache!.keys()].sort()).toEqual(
      ['', 'index.html', 'assets/app-abc.js', 'icons/icon-192.png'].map((p) => SCOPE + p).sort(),
    );
  });

  it('טעינה במצב לא מקוון: קבצים ודפי ניווט מוגשים מהמטמון בלי בקשת רשת', async () => {
    const sw = createSw(files);
    await sw.run('install');
    sw.network.online = false;
    expect(await sw.run('fetch', { request: sw.req('assets/app-abc.js') })).toEqual({
      body: `body:${SCOPE}assets/app-abc.js`,
    });
    expect(await sw.run('fetch', { request: sw.req('week/3?x=1', { mode: 'navigate' }) })).toEqual({
      body: `body:${SCOPE}index.html`,
    });
    expect(sw.network.requests).toEqual([]);
  });

  it('לא מתערב בבקשות חוץ-תחומיות ובבקשות שאינן GET', async () => {
    const sw = createSw(files);
    await sw.run('install');
    let responded = false;
    const handlers = { respondWith: () => (responded = true) };
    await sw.run('fetch', { ...handlers, request: { method: 'GET', mode: 'cors', url: 'https://other.example/x.js' } });
    await sw.run('fetch', { ...handlers, request: sw.req('index.html', { method: 'POST' }) });
    expect(responded).toBe(false);
  });

  it('גרסה חדשה ממתינה ולא מדלגת עד שמתקבלת הודעת עדכון', async () => {
    const sw = createSw(files);
    await sw.run('install');
    expect(sw.wasSkipped()).toBe(false);
    await sw.run('message', { data: { type: 'IRRELEVANT' } });
    expect(sw.wasSkipped()).toBe(false);
    await sw.run('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.wasSkipped()).toBe(true);
  });

  it('בהפעלה מוחק מטמונים ישנים של האפליקציה ורק אותם', async () => {
    const store = new Map<string, Map<string, string>>([
      ['planner-old', new Map()],
      ['unrelated', new Map()],
    ]);
    const sw = createSw(files, store);
    await sw.run('install');
    await sw.run('activate');
    const names = [...store.keys()];
    expect(names).not.toContain('planner-old');
    expect(names).toContain('unrelated');
    expect(names.filter((n) => n.startsWith('planner-'))).toHaveLength(1);
  });

  it('שינוי תוכן קובץ מייצר שם מטמון חדש', () => {
    const a = buildServiceWorker(template, files);
    const b = buildServiceWorker(template, { ...files, 'assets/app-abc.js': 'changed' });
    expect(a).not.toBe(b);
    expect(buildServiceWorker(template, files)).toBe(a);
  });
});
