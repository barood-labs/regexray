/// Match worker — isolates RegExp.exec so catastrophic backtracking can't freeze the UI.

export type MatchRequest = {
  id: number;
  pattern: string;
  flags: string;
  input: string;
  /** Soft deadline in ms from worker receipt. */
  timeoutMs: number;
};

export type MatchHit = {
  index: number;
  length: number;
  text: string;
  groups: (string | undefined)[];
  named?: Record<string, string | undefined>;
};

export type MatchResponse =
  | { id: number; ok: true; hits: MatchHit[]; truncated: boolean }
  | { id: number; ok: false; error: string };

const MAX_HITS = 500;

self.onmessage = (ev: MessageEvent<MatchRequest>) => {
  const { id, pattern, flags, input, timeoutMs } = ev.data;
  const started = Date.now();
  try {
    // Strip anything that isn't a real flag — never eval.
    const cleanFlags = (flags || '').replace(/[^gimsuy]/g, '');
    // Always add 'd' when available for indices; fall back silently.
    let re: RegExp;
    try {
      re = new RegExp(pattern, cleanFlags.includes('d') ? cleanFlags : cleanFlags + 'd');
    } catch {
      re = new RegExp(pattern, cleanFlags);
    }

    const hits: MatchHit[] = [];
    let truncated = false;

    if (!cleanFlags.includes('g')) {
      if (Date.now() - started > timeoutMs) {
        (self as unknown as Worker).postMessage({ id, ok: false, error: 'Match timed out (catastrophic backtracking?)' } satisfies MatchResponse);
        return;
      }
      const m = re.exec(input);
      if (m) {
        hits.push({
          index: m.index,
          length: m[0].length,
          text: m[0],
          groups: Array.from(m).slice(1),
          named: m.groups,
        });
      }
    } else {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(input)) !== null) {
        if (Date.now() - started > timeoutMs) {
          (self as unknown as Worker).postMessage({ id, ok: false, error: 'Match timed out (catastrophic backtracking?)' } satisfies MatchResponse);
          return;
        }
        hits.push({
          index: m.index,
          length: m[0].length,
          text: m[0],
          groups: Array.from(m).slice(1),
          named: m.groups,
        });
        if (m[0].length === 0) {
          // Avoid zero-width infinite loop
          re.lastIndex = m.index + 1;
        }
        if (++guard >= MAX_HITS) {
          truncated = true;
          break;
        }
      }
    }

    (self as unknown as Worker).postMessage({ id, ok: true, hits, truncated } satisfies MatchResponse);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    (self as unknown as Worker).postMessage({ id, ok: false, error } satisfies MatchResponse);
  }
};
