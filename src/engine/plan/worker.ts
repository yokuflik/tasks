import { generateSchedules } from './generate';
import type { GenerateInput, GeneratedSet } from './generate';

/** הרצה כבדה בעובד רקע כדי שהממשק לא ייתקע (DESIGN 3.1, מגבלה 4). הלוגיקה עצמה נקייה ונבדקת בלי דפדפן. */
export interface WorkerRequest {
  id: number;
  input: GenerateInput;
}

export type WorkerResponse = { id: number; ok: true; result: GeneratedSet } | { id: number; ok: false; error: string };

export function handleRequest(req: WorkerRequest): WorkerResponse {
  try {
    return { id: req.id, ok: true, result: generateSchedules(req.input) };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

declare const WorkerGlobalScope: unknown;
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof (WorkerGlobalScope as typeof Object)) {
  (self as unknown as { onmessage: (e: { data: WorkerRequest }) => void; postMessage: (r: WorkerResponse) => void }).onmessage = (e) => {
    (self as unknown as { postMessage: (r: WorkerResponse) => void }).postMessage(handleRequest(e.data));
  };
}
