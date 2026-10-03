/* global self, caches, URL, __PRECACHE__ */
// תבנית ה-Service Worker. ערכי הגרסה ורשימת הקבצים מוזרקים בבנייה (src/pwa/build.ts).
// כל הנתיבים יחסיים לתחום הרישום, בלי שם אירוח או תת-נתיב קבוע.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE_PREFIX = 'planner-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

const scopeUrl = () => self.registration.scope;
const resolve = (path) => new URL(path, scopeUrl()).href;

self.addEventListener('install', (event) => {
  // בכוונה בלי skipWaiting: הגרסה החדשה ממתינה עד שהמשתמש לוחץ "עדכן"
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map(resolve))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // אין בקשות חוץ-תחומיות: מה שמחוץ לתחום לא נענה בכלל
  if (!url.href.startsWith(scopeUrl())) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      if (request.mode === 'navigate') {
        const shell = await cache.match(resolve('index.html'));
        if (shell) return shell;
      }
      return self.fetch(request);
    }),
  );
});
