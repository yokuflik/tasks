import { useEffect, useState } from 'preact/hooks';

const WELCOME_KEY = 'planner.welcomed';
const SHOW_MS = 4000;

/** האם זו הפתיחה הראשונה (ומסמן שכבר הוצג). */
export function takeFirstRun(): boolean {
  try {
    if (localStorage.getItem(WELCOME_KEY)) return false;
    localStorage.setItem(WELCOME_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** אנימציית לב גדול בפתיחה ראשונה. נסגרת בנגיעה או אחרי כמה שניות. */
export function Welcome(): preact.JSX.Element | null {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div class="scr-welcome" role="dialog" aria-label="אני אוהב אותך" data-welcome onClick={() => setVisible(false)}>
      <div class="scr-welcome__heart" aria-hidden="true">❤️</div>
      <p class="scr-welcome__text">אני אוהב אותך ❤️</p>
    </div>
  );
}
