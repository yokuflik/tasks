import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/engine/**'],
    rules: {
      // מנוע השיבוץ חייב להישאר נקי מתלות בדפדפן ובממשק
      'no-restricted-imports': [
        'error',
        { patterns: ['preact*', '**/ui/**', '**/screens/**', '**/pwa/**', '**/storage/**'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'indexedDB'],
    },
  },
);
