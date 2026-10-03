// @vitest-environment jsdom
import { act } from 'preact/test-utils';
import { h, render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../../src/pwa/register';
import { isIos, isStandalone } from '../../src/pwa/standalone';
import { PwaOverlay } from '../../src/pwa/components';

type L = () => void;
function fakeContainer(hasController: boolean) {
  const containerListeners: Record<string, L[]> = {};
  const regListeners: Record<string, L[]> = {};
  const installing = { state: 'installing', postMessage: vi.fn(), listeners: [] as L[], addEventListener(_: string, l: L) { this.listeners.push(l); } };
  const reg = {
    waiting: null as unknown,
    installing: null as unknown,
    addEventListener: (t: string, l: L) => (regListeners[t] ??= []).push(l),
  };
  const container = {
    controller: hasController ? {} : null,
    register: vi.fn(async () => reg),
    addEventListener: (t: string, l: L) => (containerListeners[t] ??= []).push(l),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  return { container, reg, installing, regListeners, containerListeners };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks();
});

describe('עדכון גרסה', () => {
  it('נרשם בתחום יחסי', async () => {
    const f = fakeContainer(true);
    await registerServiceWorker();
    expect(f.container.register).toHaveBeenCalledWith('./sw.js', { scope: './' });
  });

  it('גרסה חדשה שהותקנה מודיעה, ורק אחרי "עדכן" נשלחת הודעה וטוענים מחדש', async () => {
    const f = fakeContainer(true);
    const reload = vi.fn();
    const handle = (await registerServiceWorker({ reload }))!;
    const ready = vi.fn();
    handle.onUpdateReady(ready);

    f.reg.installing = f.installing;
    f.regListeners.updatefound!.forEach((l) => l());
    f.installing.state = 'installed';
    f.installing.listeners.forEach((l) => l());
    expect(ready).toHaveBeenCalledTimes(1);
    expect(f.installing.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    handle.applyUpdate();
    expect(f.installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    f.containerListeners.controllerchange!.forEach((l) => l());
    f.containerListeners.controllerchange!.forEach((l) => l());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('התקנה ראשונה לא מציגה הודעת עדכון ולא טוענת מחדש', async () => {
    const f = fakeContainer(false);
    const reload = vi.fn();
    const handle = (await registerServiceWorker({ reload }))!;
    const ready = vi.fn();
    handle.onUpdateReady(ready);
    f.reg.installing = f.installing;
    f.regListeners.updatefound!.forEach((l) => l());
    f.installing.state = 'installed';
    f.installing.listeners.forEach((l) => l());
    f.containerListeners.controllerchange!.forEach((l) => l());
    expect(ready).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('גרסה שכבר ממתינה בטעינה מדווחת', async () => {
    const f = fakeContainer(true);
    f.reg.waiting = { postMessage: vi.fn() };
    const handle = (await registerServiceWorker())!;
    const ready = vi.fn();
    handle.onUpdateReady(ready);
    expect(ready).toHaveBeenCalled();
  });

  it('בלי תמיכה ב-Service Worker מחזיר null', async () => {
    expect(await registerServiceWorker()).toBeNull();
  });
});

describe('זיהוי מצב ורכיבים', () => {
  it('מזהה מצב מותקן ו-iOS', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
    Reflect.deleteProperty(navigator, 'standalone');
    expect(isStandalone()).toBe(false);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(isIos()).toBe(true);
  });

  it('מציג הנחיית התקנה וכפתור עדכון, וההנחיה נסגרת', async () => {
    const root = document.createElement('div');
    const onApply = vi.fn();
    await act(() => render(h(PwaOverlay, {showInstallGuide: true, updateReady: true, onApplyUpdate: onApply}), root));
    expect(root.textContent).toContain('הוספה למסך הבית');
    expect(root.textContent).toContain('יש גרסה חדשה');
    const buttons = [...root.querySelectorAll('button')];
    await act(() => buttons.find((b) => b.textContent === 'עדכן')!.click());
    expect(onApply).toHaveBeenCalled();
    await act(() => buttons.find((b) => b.textContent === 'הבנתי')!.click());
    expect(root.textContent).not.toContain('הוספה למסך הבית');
  });

  it('באפליקציה מותקנת ובלי עדכון לא מציג כלום', async () => {
    const root = document.createElement('div');
    await act(() => render(h(PwaOverlay, { showInstallGuide: false, updateReady: false, onApplyUpdate: () => {} }), root));
    expect(root.textContent).toBe('');
  });
});
