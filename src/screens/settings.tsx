import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { backupReminder } from '../storage';
import { Button, Card } from '../ui';
import { readText } from './entry';
import type { ScreenProps } from './types';

export function SettingsScreen(p: ScreenProps): JSX.Element {
  const s = p.data.settings;
  const [minSleep, setMinSleep] = useState(String(s.minSleepMin));
  const [target, setTarget] = useState(String(s.targetSleepMin));
  const [brk, setBrk] = useState(String(s.minBreakMin));
  const [warn, setWarn] = useState(s.warnOnSpecialDays);
  const [msg, setMsg] = useState<string | undefined>();
  const reminder = backupReminder(s.lastBackupAt, p.services.now());

  const saveSettings = () => {
    const min = Number(minSleep);
    const tgt = Number(target);
    const b = Number(brk);
    if (![min, tgt, b].every(Number.isFinite) || min <= 0 || tgt < min || b < 0) {
      setMsg('ערכים לא תקינים: היעד חייב להיות לפחות כמו המינימום');
      return;
    }
    setMsg('ההגדרות נשמרו');
    void p.actions.saveSettings({ ...s, minSleepMin: min, targetSleepMin: tgt, minBreakMin: b, warnOnSpecialDays: warn });
  };

  const onImport = async (ev: Event) => {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!p.services.confirm('השחזור יחליף את כל הנתונים הנוכחיים. להמשיך?')) {
      input.value = '';
      return;
    }
    const err = await p.actions.importBackup(await readText(file));
    setMsg(err ? `השחזור נכשל: ${err}. הנתונים לא שונו.` : 'הנתונים שוחזרו');
    input.value = '';
  };

  const reset = () => {
    if (p.services.confirm('למחוק את כל הנתונים? אי אפשר לבטל.')) void p.actions.resetAll();
  };

  return (
    <div class="scr-screen">
      <h1 class="scr-title">הגדרות וגיבוי</h1>

      <Card>
        <h2 class="scr-h2">גיבוי ושחזור</h2>
        <p class={reminder.due ? 'scr-warnbox' : 'scr-muted'} role="status" data-backup-due={reminder.due}>
          {reminder.daysSince === null ? 'עוד לא גובה. מומלץ לגבות עכשיו.' :
            reminder.due ? `הגיבוי האחרון לפני ${reminder.daysSince} ימים. הגיע הזמן לגבות.` :
              `גיבוי אחרון לפני ${reminder.daysSince} ימים.`}
        </p>
        {p.persist && !p.persist.persisted && (
          <p class="scr-warnbox" role="note" data-persist={p.persist.status}>
            הדפדפן לא אישר אחסון מתמשך. הקפד לגבות ולהתקין את האפליקציה למסך הבית.
          </p>
        )}
        <div class="scr-actions">
          <Button onClick={() => void p.actions.exportBackup()}>ייצוא גיבוי</Button>
          <label class="scr-filebtn">שחזור מגיבוי
            <input name="backup-file" type="file" accept=".json,application/json" onChange={(e) => void onImport(e)} />
          </label>
        </div>
      </Card>

      <Card>
        <h2 class="scr-h2">חוקים</h2>
        <div class="scr-form-row">
          <label>מינימום שינה (דקות)
            <input name="min-sleep" type="number" inputMode="numeric" value={minSleep} onInput={(e) => setMinSleep((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>יעד שינה (דקות)
            <input name="target-sleep" type="number" inputMode="numeric" value={target} onInput={(e) => setTarget((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>הפסקה מינימלית (דקות)
            <input name="min-break" type="number" inputMode="numeric" value={brk} onInput={(e) => setBrk((e.currentTarget as HTMLInputElement).value)} />
          </label>
        </div>
        <label class="scr-check">
          <input name="warn-special" type="checkbox" checked={warn} onChange={(e) => setWarn((e.currentTarget as HTMLInputElement).checked)} />
          אזהרה עדינה כשמשימה מונחת על שבת או חג
        </label>
        <Button variant="secondary" onClick={saveSettings}>שמור הגדרות</Button>
      </Card>

      <Card>
        <h2 class="scr-h2">קטגוריות</h2>
        <ul class="scr-list" aria-label="קטגוריות">
          {p.data.categories.map((c) => (
            <li key={c.id} data-category={c.id}>
              <input
                aria-label={`שם הקטגוריה ${c.name}`}
                name={`cat-name-${c.id}`}
                value={c.name}
                onChange={(e) => {
                  const name = (e.currentTarget as HTMLInputElement).value.trim();
                  if (name) void p.actions.saveCategory({ ...c, name });
                }}
              />
              <input
                type="color"
                aria-label={`צבע ${c.name}`}
                name={`cat-color-${c.id}`}
                value={c.color}
                onChange={(e) => void p.actions.saveCategory({ ...c, color: (e.currentTarget as HTMLInputElement).value })}
              />
            </li>
          ))}
        </ul>
      </Card>

      {msg && <p class="scr-muted" role="status">{msg}</p>}

      <Card>
        <h2 class="scr-h2">מחיקת נתונים</h2>
        <Button variant="secondary" onClick={reset}>מחק את כל הנתונים</Button>
      </Card>
    </div>
  );
}
