export interface UpdateHandle {
  /** מופעל כשגרסה חדשה הותקנה וממתינה */
  onUpdateReady(cb: () => void): void;
  /** מעביר את הגרסה הממתינה לפעילה וטוען מחדש את הדף */
  applyUpdate(): void;
}

interface Options {
  /** נתיב יחסי לדף הנוכחי */
  swUrl?: string;
  reload?: () => void;
}

/** רושם את ה-SW בתחום היחסי לדף. מחזיר null כשאין תמיכה. */
export async function registerServiceWorker(opts: Options = {}): Promise<UpdateHandle | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const container = navigator.serviceWorker;
  const reload = opts.reload ?? (() => location.reload());
  const listeners: Array<() => void> = [];
  let waiting: ServiceWorker | null = null;
  const hadController = container.controller !== null;

  const notify = (worker: ServiceWorker) => {
    // בהתקנה ראשונה אין מה לעדכן
    if (!hadController && !container.controller) return;
    waiting = worker;
    listeners.forEach((cb) => cb());
  };

  const reg = await container.register(opts.swUrl ?? './sw.js', { scope: './' });
  if (reg.waiting) notify(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') notify(installing);
    });
  });

  let reloaded = false;
  container.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    reload();
  });

  return {
    onUpdateReady(cb) {
      listeners.push(cb);
      if (waiting) cb();
    },
    applyUpdate() {
      waiting?.postMessage({ type: 'SKIP_WAITING' });
    },
  };
}
