import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario } from '../contracts/scenario';

/**
 * טעינת תרחיש משותף בסביבת jsdom. fixtures/index.ts נשען על import.meta.url, ש-jsdom משנה,
 * ולכן כאן הנתיב מחושב מהשורש של הפרויקט (Vitest רץ משם).
 */
export function loadScenarioFile(name: string): Scenario {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'scenarios', `${name}.json`), 'utf8')) as Scenario;
}
