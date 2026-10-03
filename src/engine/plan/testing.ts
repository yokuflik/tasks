import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../../contracts/defaults';
import type { Category, IsoDate, Task } from '../../contracts';
import type { Scenario } from '../../contracts/scenario';
import { addDays } from '../base/dates';
import { DAYS, START, shift, task, week } from '../base/testing/helpers';
import type { GenerateInput } from './generate';

export { DAYS, START, shift, task, week };

export function inputOf(tasks: Task[], over: Partial<GenerateInput> = {}): GenerateInput {
  return { week: week(), tasks, categories: DEFAULT_CATEGORIES as Category[], settings: DEFAULT_SETTINGS, ...over };
}

export function fromScenario(s: Scenario, seed?: number): GenerateInput {
  return {
    week: s.week,
    tasks: s.tasks,
    categories: s.categories,
    settings: s.settings,
    ...(seed !== undefined ? { seed } : {}),
  };
}

const CATS = ['study', 'fitness', 'health', 'errands', 'home', 'family', 'friends', 'leisure', 'personal'];
const EFFORTS = ['heavy', 'medium', 'light'] as const;
const PRIOS = ['high', 'medium', 'low'] as const;

/** שבוע גדול ומגוון (דטרמיניסטי): משמרות, משימות בכל הקטגוריות, חלקן עם יעד, תלות וחזרתיות. */
export function bigWeek(count: number): GenerateInput {
  const tasks: Task[] = [shift('s0', 0, 8 * 60, 480), shift('s1', 2, 8 * 60, 480), shift('s2', 4, 14 * 60, 480)];
  for (let i = 0; i < count; i++) {
    const due: IsoDate | undefined = i % 7 === 3 ? addDays(START, 3 + (i % 3)) : undefined;
    tasks.push(
      task(`t${i}`, {
        categoryId: CATS[i % CATS.length]!,
        durationMin: 30 + (i % 5) * 30,
        priority: PRIOS[i % 3]!,
        effort: EFFORTS[(i + 1) % 3]!,
        timesPerWeek: i % 11 === 5 ? 3 : 1,
        split: { splittable: i % 6 === 2, minSegmentMin: 30 },
        dependsOn: i % 9 === 8 ? [`t${i - 1}`] : [],
        ...(due ? { dueDate: due } : {}),
      }),
    );
  }
  return inputOf(tasks);
}
