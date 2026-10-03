import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { pwaServiceWorker } from './src/pwa/build';

export default defineConfig({
  plugins: [preact(), pwaServiceWorker()],
  // GitHub Pages מגיש מתת-נתיב; יוגדר סופית ב-P9
  base: './',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
});
