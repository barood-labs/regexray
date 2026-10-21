import type { MatchHit, MatchRequest, MatchResponse } from './matchWorker';
import MatchWorker from './matchWorker?worker';

export type { MatchHit };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, {
  resolve: (r: MatchResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function getWorker(): Worker {
  if (!worker) {
    worker = new MatchWorker();
    worker.onmessage = (ev: MessageEvent<MatchResponse>) => {
      const slot = pending.get(ev.data.id);
      if (!slot) return;
      clearTimeout(slot.timer);
      pending.delete(ev.data.id);
      slot.resolve(ev.data);
    };
    worker.onerror = () => {
      // Recreate on hard failure
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

export function matchAsync(
  pattern: string,
  flags: string,
  input: string,
  timeoutMs = 150,
): Promise<MatchResponse> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // Kill hung worker and recreate
      try { w.terminate(); } catch { /* ignore */ }
      worker = null;
      resolve({ id, ok: false, error: 'Match timed out (catastrophic backtracking?)' });
    }, timeoutMs + 50);
    pending.set(id, { resolve, timer });
    const req: MatchRequest = { id, pattern, flags, input, timeoutMs };
    w.postMessage(req);
  });
}

/** Validate that a pattern compiles under given flags. */
export function validateRegex(pattern: string, flags: string): { ok: true; flags: string } | { ok: false; error: string } {
  const cleanFlags = (flags || '').replace(/[^gimsuy]/g, '');
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, cleanFlags);
    return { ok: true, flags: cleanFlags };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
