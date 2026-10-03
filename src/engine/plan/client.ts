import type { GenerateInput, GeneratedSet } from './generate';
import type { WorkerResponse } from './worker';

/** מפיק את שלוש הוריאציות בעובד רקע. מסך ההפקה (P7) קורא לזה במקום ל-generateSchedules. */
export function generateInWorker(input: GenerateInput): Promise<GeneratedSet> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ id: 1, input });
  });
}
