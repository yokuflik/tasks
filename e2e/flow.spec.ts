import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** ראשון של השבוע הנוכחי (שעון ישראל), כמו שהאפליקציה מחשבת */
function weekDates(): string[] {
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()) + 'T12:00:00Z');
  const sunday = new Date(today.getTime() - today.getUTCDay() * 86_400_000);
  return Array.from({ length: 7 }, (_, i) => new Date(sunday.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

/** בדפדפן רגיל באייפון מוצגת הנחיית התקנה; סוגרים אותה כמו משתמש */
async function dismissInstallGuide(page: Page) {
  const ok = page.getByRole('button', { name: 'הבנתי' });
  await ok.click({ timeout: 3000 }).catch(() => {});
}

const nav = (page: Page, id: string) => page.locator(`[data-nav="${id}"]`).click();

test('משתמש חדש: משמרות, משימות, שלושה סידורים, בחירה, עריכה, ICS, גיבוי, מחיקה, שחזור, סגירה ופתיחה', async ({ page }) => {
  const days = weekDates();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await dismissInstallGuide(page);
  await page.getByRole('button', { name: 'צור שבוע חדש' }).click();

  for (const [i, s, e] of [[0, '07:00', '15:00'], [1, '07:00', '15:00'], [2, '22:00', '06:00']] as const) {
    await page.locator('[name="shift-date"]').selectOption(days[i]!);
    await page.locator('[name="shift-start"]').fill(s);
    await page.locator('[name="shift-end"]').fill(e);
    await page.getByRole('button', { name: 'הוסף משמרת' }).click();
  }
  await expect(page.locator('[data-shift]')).toHaveCount(3);

  for (const [title, cat, dur] of [['אימון', 'fitness', '60'], ['קניות', 'errands', '45'], ['לימוד', 'study', '120']] as const) {
    await page.locator('[name="title"]').fill(title);
    await page.locator('[name="category"]').selectOption(cat);
    await page.locator('[name="duration"]').fill(dur);
    await page.getByRole('button', { name: 'הוסף משימה' }).click();
  }
  await expect(page.locator('[data-task]')).toHaveCount(3);

  await page.locator('[name="blocked-title"]').fill('ארוחה משפחתית');
  await page.locator('[name="blocked-date"]').selectOption(days[5]!);
  await page.locator('[name="blocked-start"]').fill('13:00');
  await page.locator('[name="blocked-end"]').fill('15:00');
  await page.getByRole('button', { name: 'הוסף זמן חסום' }).click();
  await expect(page.locator('[data-blocked]')).toHaveCount(1);

  // הפקה בעובד רקע אמיתי, והשוואה
  await page.getByRole('button', { name: 'הפק סידורים' }).click();
  await expect(page.locator('[data-screen="compare"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-schedule]')).toHaveCount(3);
  await page.locator('[data-personality="balanced"] button', { hasText: 'בחר סידור זה' }).click();
  await expect(page.locator('[data-screen="week"]')).toBeVisible();
  await expect(page.locator('.scr-col')).toHaveCount(7);
  await expect(page.locator('[data-kind="task"]').first()).toBeVisible();

  // עריכה: הזזת משימה גמישה דרך פרטי הבלוק
  // משמרות קבועות אינן ניתנות להזזה, ולכן בוחרים את האימון
  await page.locator('[data-kind="task"]', { hasText: 'אימון' }).first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.locator('[name="move-date"]').selectOption(days[6]!);
  await page.locator('[name="move-time"]').fill('10:00');
  await page.getByRole('button', { name: 'הזז' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden();

  await nav(page, 'day');
  await nav(page, 'overview');
  await expect(page.locator('.scr-days__row')).toHaveCount(7);

  // ייצוא ICS
  await nav(page, 'week');
  const [ics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ייצוא ליומן (ICS)' }).click()]);
  expect(ics.suggestedFilename()).toBe(`schedule-${days[0]}.ics`);
  const icsText = readFileSync((await ics.path())!, 'utf8');
  expect(icsText).toContain('BEGIN:VCALENDAR');
  expect(icsText).toContain('BEGIN:VEVENT');

  // גיבוי
  await nav(page, 'settings');
  const [backup] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ייצוא גיבוי' }).click()]);
  const backupPath = (await backup.path())!;
  JSON.parse(readFileSync(backupPath, 'utf8'));

  // מחיקה
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'מחק את כל הנתונים' }).click();
  await nav(page, 'week');
  await expect(page.locator('.scr-col')).toHaveCount(0);

  // שחזור
  await nav(page, 'settings');
  await page.locator('[name="backup-file"]').setInputFiles(backupPath);
  await expect(page.getByText('הנתונים שוחזרו')).toBeVisible();

  // סגירה ופתיחה מחדש (טעינה מחדש, אותו אחסון)
  await page.reload();
  await dismissInstallGuide(page);
  await nav(page, 'week');
  await expect(page.locator('.scr-col')).toHaveCount(7);
  await expect(page.locator('[data-kind="task"]').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('עבודה בלי רשת אחרי הטעינה הראשונה', async ({ page }) => {
  // שרת סטטי משלנו מעל dist, כדי שאפשר יהיה לכבות אותו באמת (setOffline ב-WebKit קורס עם service worker)
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    try {
      const body = readFileSync(join(process.cwd(), 'dist', path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': types[extname(path === '/' ? 'index.html' : path)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((r) => server.listen(4180, r));
  try {
    await page.goto('http://localhost:4180/');
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, { timeout: 20_000 });
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  } finally {
    await new Promise((r) => server.close(r));
  }
  await page.reload();
  await expect(page.locator('[data-screen]')).toBeVisible();
  await expect(page.locator('[data-nav="settings"]')).toBeVisible();
});

test('מצב כהה, RTL ואזורים בטוחים', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('[data-screen]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('he');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number) as [number, number, number];
  expect((r + g + b) / 3).toBeLessThan(80);
  await page.screenshot({ path: 'test-results/dark-home.png' });
});
