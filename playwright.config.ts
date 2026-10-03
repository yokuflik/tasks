import { defineConfig, devices } from '@playwright/test';

// בדיקות קצה לקצה על WebKit (המנוע של Safari באייפון), מול גרסת הייצור
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['iPhone 14'],
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
