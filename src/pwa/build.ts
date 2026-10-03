import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const TEMPLATE_PATH = new URL('./sw.js', import.meta.url);

/** מחליף את ה-placeholders בתבנית ה-SW. הגרסה נגזרת מתוכן הקבצים, כך שכל שינוי מייצר מטמון חדש. */
export function buildServiceWorker(template: string, files: Record<string, string | Uint8Array>): string {
  const paths = Object.keys(files).sort();
  const hash = createHash('sha256');
  for (const p of paths) hash.update(p).update(files[p] as string | Uint8Array);
  const version = hash.digest('hex').slice(0, 12);
  return template
    .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`)
    .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(['./', ...paths])};`);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** תוסף Vite: אחרי הבנייה יוצר dist/sw.js עם רשימת כל הקבצים לשמירה מראש. */
export function pwaServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'planner-pwa-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle: {
      order: 'post',
      async handler() {
        const { writeFileSync } = await import('node:fs');
        const files: Record<string, string | Uint8Array> = {};
        for (const full of listFiles(outDir)) {
          const rel = relative(outDir, full).split(sep).join('/');
          if (rel === 'sw.js') continue;
          files[rel] = readFileSync(full);
        }
        writeFileSync(join(outDir, 'sw.js'), buildServiceWorker(readFileSync(TEMPLATE_PATH, 'utf8'), files));
      },
    },
  };
}
