import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { pwaServiceWorker } from './src/pwa/build';

export default defineConfig({
  plugins: [preact(), pwaServiceWorker()],
  // GitHub Pages מגיש מתת-נתיב; יוגדר סופית ב-P9
  base: './',
  test: {
    environment: 'node',
    testTimeout: 30000,
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
});
