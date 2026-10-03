import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '../src/contracts/scenario';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'scenarios');

/** כל תרחישי הבדיקה המשותפים, לפי שם קובץ. לשימוש בטסטים בלבד (Node). */
export function loadScenarios(): Record<string, Scenario> {
  const out: Record<string, Scenario> = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Scenario;
  }
  return out;
}

export function loadScenario(name: string): Scenario {
  const s = loadScenarios()[name];
  if (!s) throw new Error(`תרחיש לא קיים: ${name}`);
  return s;
}
