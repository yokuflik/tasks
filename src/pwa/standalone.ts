/** האם האפליקציה רצה כמותקנת במסך הבית (מסך מלא) או בלשונית דפדפן. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS מדווח כ-Macintosh עם מסך מגע
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
