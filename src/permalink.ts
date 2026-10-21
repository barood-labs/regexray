export type PermalinkState = {
  pattern: string;
  flags: string;
  test: string;
};

/** Encode state into a URL hash (no server). */
export function encodePermalink(state: PermalinkState): string {
  const payload = JSON.stringify({
    p: state.pattern,
    f: state.flags,
    t: state.test,
  });
  // base64url
  const b64 = btoa(unescape(encodeURIComponent(payload)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `#r=${b64}`;
}

export function decodePermalink(hash: string): PermalinkState | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const params = new URLSearchParams(raw.includes('=') && !raw.startsWith('r=') ? raw : raw);
    // support both #r=… and legacy ? form inside hash
    let b64 = params.get('r');
    if (!b64 && raw.startsWith('r=')) b64 = raw.slice(2);
    if (!b64) return null;
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    const data = JSON.parse(json) as { p?: string; f?: string; t?: string };
    if (typeof data.p !== 'string') return null;
    return {
      pattern: data.p,
      flags: typeof data.f === 'string' ? data.f : '',
      test: typeof data.t === 'string' ? data.t : '',
    };
  } catch {
    return null;
  }
}

export function applyPermalinkToLocation(state: PermalinkState): void {
  const next = encodePermalink(state);
  if (location.hash !== next) {
    history.replaceState(null, '', next);
  }
}
