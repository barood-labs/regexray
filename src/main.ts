import './styles.css';
import { EXAMPLES } from './examples';
import { tokenize, type Token } from './tokenize';
import { parsePattern, coalesceLiterals } from './parse';
import { renderRailroad } from './railroad';
import { matchAsync, validateRegex, type MatchHit } from './match';
import { decodePermalink, applyPermalinkToLocation, encodePermalink } from './permalink';
import { svgToPngBlob, downloadBlob, toMarkdown } from './export';

const FLAG_CHARS = ['g', 'i', 'm', 's', 'u', 'y'] as const;

type State = {
  pattern: string;
  flags: string;
  test: string;
  activeExample: string | null;
};

const state: State = {
  pattern: EXAMPLES[0].pattern,
  flags: EXAMPLES[0].flags,
  test: EXAMPLES[0].test,
  activeExample: EXAMPLES[0].id,
};

let latestSvg = '';
let matchSeq = 0;

const app = document.getElementById('app')!;

app.innerHTML = `
  <header class="hero">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="32" r="5" fill="#5eead4"/>
          <circle cx="46" cy="32" r="5" fill="#5eead4"/>
          <path d="M23 32h18" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
          <path d="M18 32c6-14 22-14 28 0" stroke="#5eead4" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
          <path d="M18 32c6 14 22 14 28 0" stroke="#5eead4" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
        </svg>
      </div>
      <div>
        <h1>RegexRay</h1>
        <p>See your regex — railroad diagram, live matches, plain English. 100% in your browser.</p>
      </div>
    </div>
    <div class="hero-actions">
      <button class="btn" id="btn-copy-link" type="button" title="Copy shareable permalink">Copy link</button>
      <button class="btn" id="btn-copy-md" type="button">Copy Markdown</button>
      <button class="btn primary" id="btn-export-png" type="button">Export PNG</button>
    </div>
  </header>

  <div class="examples" id="examples" role="list"></div>
  <p class="example-blurb" id="example-blurb"></p>

  <div class="grid" style="margin-top:14px">
    <section class="panel">
      <div class="panel-hd"><h2>Pattern</h2><span class="pill" id="status-pill">ready</span></div>
      <div class="panel-bd">
        <div class="pattern-row">
          <span class="slash" aria-hidden="true">/</span>
          <label class="sr-only" for="pattern">Regular expression</label>
          <textarea id="pattern" class="pattern" spellcheck="false" autocomplete="off" autocapitalize="off">${escapeHtml(state.pattern)}</textarea>
          <div>
            <label class="sr-only" for="flags">Flags</label>
            <input id="flags" class="flags" maxlength="6" spellcheck="false" value="${escapeHtml(state.flags)}" title="Flags: g i m s u y" />
          </div>
          <span class="slash" aria-hidden="true">/</span>
        </div>
        <div class="flags-help" id="flag-chips"></div>
        <div class="error-banner" id="error" role="alert"></div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-hd"><h2>Plain English</h2><button class="btn ghost" id="btn-copy-explain" type="button">Copy</button></div>
      <div class="panel-bd">
        <ul class="explain-list" id="explain"></ul>
      </div>
    </section>

    <section class="panel span-2">
      <div class="panel-hd">
        <h2>Railroad diagram</h2>
        <span class="pill" id="diagram-meta">—</span>
      </div>
      <div class="panel-bd">
        <div class="diagram-wrap" id="diagram">
          <div class="diagram-empty">Type a pattern to see its railroad diagram.</div>
        </div>
      </div>
    </section>

    <section class="panel span-2">
      <div class="panel-hd"><h2>Test string</h2><div class="match-meta" id="match-meta"></div></div>
      <div class="panel-bd">
        <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label class="sr-only" for="test">Test string</label>
            <textarea id="test" class="test" spellcheck="false">${escapeHtml(state.test)}</textarea>
          </div>
          <div>
            <div class="highlight-view" id="highlight" aria-live="polite"></div>
            <div class="groups" id="groups"></div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <footer class="footer">
    <div>
      A free <span class="mark">no-tricks</span> tool by
      <a href="https://github.com/barood-labs" target="_blank" rel="noopener">barood-labs</a>
      — also try
      <a href="https://barood-labs.github.io/notricks-tools/" target="_blank" rel="noopener">No-Tricks Tools</a>
      &amp;
      <a href="https://barood-labs.github.io/mossloop/" target="_blank" rel="noopener">Mossloop</a>.
    </div>
    <div>Runs fully offline after load · no account · no tracking · MIT</div>
  </footer>
  <div class="toast" id="toast" role="status"></div>
`;

const el = {
  pattern: app.querySelector('#pattern') as HTMLTextAreaElement,
  flags: app.querySelector('#flags') as HTMLInputElement,
  test: app.querySelector('#test') as HTMLTextAreaElement,
  error: app.querySelector('#error') as HTMLDivElement,
  explain: app.querySelector('#explain') as HTMLUListElement,
  diagram: app.querySelector('#diagram') as HTMLDivElement,
  diagramMeta: app.querySelector('#diagram-meta') as HTMLSpanElement,
  highlight: app.querySelector('#highlight') as HTMLDivElement,
  groups: app.querySelector('#groups') as HTMLDivElement,
  matchMeta: app.querySelector('#match-meta') as HTMLDivElement,
  status: app.querySelector('#status-pill') as HTMLSpanElement,
  examples: app.querySelector('#examples') as HTMLDivElement,
  blurb: app.querySelector('#example-blurb') as HTMLParagraphElement,
  flagChips: app.querySelector('#flag-chips') as HTMLDivElement,
  toast: app.querySelector('#toast') as HTMLDivElement,
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg: string) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  window.clearTimeout((toast as unknown as { _t?: number })._t);
  (toast as unknown as { _t?: number })._t = window.setTimeout(() => el.toast.classList.remove('show'), 1600);
}

function renderExamples() {
  el.examples.innerHTML = EXAMPLES.map(
    (ex) => `<button type="button" data-id="${ex.id}" class="${state.activeExample === ex.id ? 'active' : ''}" role="listitem">${escapeHtml(ex.label)}</button>`,
  ).join('');
  const active = EXAMPLES.find((e) => e.id === state.activeExample);
  el.blurb.textContent = active?.blurb ?? 'Pick an example, or paste your own.';
}

function renderFlagChips() {
  el.flagChips.innerHTML = FLAG_CHARS.map((f) => {
    const on = state.flags.includes(f);
    const tip: Record<string, string> = {
      g: 'global',
      i: 'ignore case',
      m: 'multiline ^ $',
      s: 'dotAll',
      u: 'unicode',
      y: 'sticky',
    };
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-flag="${f}" title="${tip[f]}">${f}</button>`;
  }).join('');
}

function setError(msg: string | null) {
  if (msg) {
    el.error.textContent = msg;
    el.error.classList.add('show');
    el.pattern.classList.add('invalid');
    el.status.textContent = 'invalid';
    el.status.className = 'pill err';
  } else {
    el.error.textContent = '';
    el.error.classList.remove('show');
    el.pattern.classList.remove('invalid');
    el.status.textContent = 'valid';
    el.status.className = 'pill ok';
  }
}

function renderExplain(tokens: Token[]) {
  if (!tokens.length) {
    el.explain.innerHTML = `<li><span class="tok muted">(empty)</span><span class="desc">An empty pattern matches the empty string at every position.</span></li>`;
    return;
  }
  el.explain.innerHTML = tokens
    .map(
      (t, i) =>
        `<li data-i="${i}" data-start="${t.start}" data-end="${t.end}"><span class="tok ${t.tone ?? 'muted'}">${escapeHtml(t.text)}</span><span class="desc">${escapeHtml(t.explain)}</span></li>`,
    )
    .join('');
}

function renderDiagram(pattern: string) {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) {
    el.diagram.innerHTML = `<div class="diagram-empty">Can't draw diagram: ${escapeHtml(parsed.error)}</div>`;
    el.diagramMeta.textContent = 'parse error';
    latestSvg = '';
    return;
  }
  const ast = coalesceLiterals(parsed.ast);
  const { svg, width, height } = renderRailroad(ast);
  latestSvg = svg;
  el.diagram.innerHTML = svg.replace(/^<\?xml[^>]*>/, '');
  el.diagramMeta.textContent = `${width}×${height}`;
}

function renderHighlights(input: string, hits: MatchHit[]) {
  if (!input) {
    el.highlight.innerHTML = `<span style="color:var(--muted)">Matches appear here.</span>`;
    return;
  }
  if (!hits.length) {
    el.highlight.textContent = input;
    return;
  }
  // Build highlighted HTML; never nest marks incorrectly.
  const points: { i: number; kind: 'start' | 'end'; hit: number; g?: number }[] = [];
  hits.forEach((h, hi) => {
    points.push({ i: h.index, kind: 'start', hit: hi });
    points.push({ i: h.index + h.length, kind: 'end', hit: hi });
  });
  points.sort((a, b) => a.i - b.i || (a.kind === 'end' ? -1 : 1));

  let html = '';
  let cursor = 0;
  let open = 0;
  for (const p of points) {
    if (p.i > cursor) {
      html += escapeHtml(input.slice(cursor, p.i));
      cursor = p.i;
    }
    if (p.kind === 'start') {
      const gClass = hits[p.hit].groups.length ? ` g${(p.hit % 4) + 1}` : '';
      html += `<mark class="${gClass.trim()}">`;
      open++;
    } else {
      html += `</mark>`;
      open--;
    }
  }
  if (cursor < input.length) html += escapeHtml(input.slice(cursor));
  while (open-- > 0) html += `</mark>`;
  el.highlight.innerHTML = html;
}

function renderGroups(hits: MatchHit[]) {
  if (!hits.length) {
    el.groups.innerHTML = '';
    return;
  }
  const rows = hits
    .slice(0, 50)
    .map((h, i) => {
      const groups = h.groups
        .map((g, gi) => `<div><span style="color:var(--muted)">$${gi + 1}</span> <code>${escapeHtml(g ?? '')}</code></div>`)
        .join('');
      const named = h.named
        ? Object.entries(h.named)
            .map(([k, v]) => `<div><span style="color:var(--muted)">$&lt;${escapeHtml(k)}&gt;</span> <code>${escapeHtml(v ?? '')}</code></div>`)
            .join('')
        : '';
      return `<tr>
        <td>${i + 1}</td>
        <td>${h.index}…${h.index + h.length}</td>
        <td><code>${escapeHtml(h.text)}</code></td>
        <td>${groups || named || '<span style="color:var(--muted)">—</span>'}${named && groups ? named : named}</td>
      </tr>`;
    })
    .join('');
  el.groups.innerHTML = `<table>
    <thead><tr><th>#</th><th>span</th><th>match</th><th>groups</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function runMatch() {
  const seq = ++matchSeq;
  const v = validateRegex(state.pattern, state.flags);
  if (!v.ok) {
    el.matchMeta.innerHTML = `<span class="pill err">no match run</span>`;
    el.highlight.textContent = state.test;
    el.groups.innerHTML = '';
    return;
  }
  if (!state.pattern) {
    el.matchMeta.innerHTML = `<span class="pill">empty pattern</span>`;
    el.highlight.textContent = state.test;
    el.groups.innerHTML = '';
    return;
  }
  el.matchMeta.innerHTML = `<span class="pill">matching…</span>`;
  const res = await matchAsync(state.pattern, v.flags, state.test, 150);
  if (seq !== matchSeq) return;
  if (!res.ok) {
    el.matchMeta.innerHTML = `<span class="pill err">${escapeHtml(res.error)}</span>`;
    el.highlight.textContent = state.test;
    el.groups.innerHTML = '';
    return;
  }
  const n = res.hits.length;
  el.matchMeta.innerHTML = `
    <span class="pill ok">${n} match${n === 1 ? '' : 'es'}</span>
    ${res.truncated ? `<span class="pill warn">truncated at 500</span>` : ''}
  `;
  renderHighlights(state.test, res.hits);
  renderGroups(res.hits);
}

function refresh(opts: { skipPermalink?: boolean } = {}) {
  renderFlagChips();
  renderExamples();

  const v = validateRegex(state.pattern, state.flags);
  const tokens = tokenize(state.pattern);
  renderExplain(tokens);

  if (!v.ok) {
    setError(v.error);
    el.diagram.innerHTML = `<div class="diagram-empty">Fix the pattern to draw a diagram.</div>`;
    el.diagramMeta.textContent = 'invalid';
    latestSvg = '';
  } else {
    setError(null);
    renderDiagram(state.pattern);
  }

  void runMatch();

  if (!opts.skipPermalink) {
    applyPermalinkToLocation({ pattern: state.pattern, flags: state.flags, test: state.test });
  }
}

// Events
el.pattern.addEventListener('input', () => {
  state.pattern = el.pattern.value;
  state.activeExample = null;
  refresh();
});
el.flags.addEventListener('input', () => {
  state.flags = el.flags.value.replace(/[^gimsuy]/g, '');
  el.flags.value = state.flags;
  refresh();
});
el.test.addEventListener('input', () => {
  state.test = el.test.value;
  state.activeExample = null;
  refresh();
});

el.examples.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button[data-id]') as HTMLButtonElement | null;
  if (!btn) return;
  const ex = EXAMPLES.find((x) => x.id === btn.dataset.id);
  if (!ex) return;
  state.pattern = ex.pattern;
  state.flags = ex.flags;
  state.test = ex.test;
  state.activeExample = ex.id;
  el.pattern.value = state.pattern;
  el.flags.value = state.flags;
  el.test.value = state.test;
  refresh();
});

el.flagChips.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button[data-flag]') as HTMLButtonElement | null;
  if (!btn) return;
  const f = btn.dataset.flag!;
  if (state.flags.includes(f)) state.flags = state.flags.replace(new RegExp(f, 'g'), '');
  else state.flags += f;
  // keep stable order
  state.flags = FLAG_CHARS.filter((c) => state.flags.includes(c)).join('');
  el.flags.value = state.flags;
  refresh();
});

document.getElementById('btn-copy-link')!.addEventListener('click', async () => {
  const url = location.origin + location.pathname + encodePermalink({
    pattern: state.pattern,
    flags: state.flags,
    test: state.test,
  });
  await navigator.clipboard.writeText(url);
  toast('Permalink copied');
});

document.getElementById('btn-copy-md')!.addEventListener('click', async () => {
  const md = toMarkdown(state.pattern, state.flags, state.test);
  await navigator.clipboard.writeText(md);
  toast('Markdown copied');
});

document.getElementById('btn-copy-explain')!.addEventListener('click', async () => {
  const tokens = tokenize(state.pattern);
  const text = tokens.map((t) => `${t.text} — ${t.explain}`).join('\n');
  await navigator.clipboard.writeText(text || '(empty pattern)');
  toast('Explanation copied');
});

document.getElementById('btn-export-png')!.addEventListener('click', async () => {
  if (!latestSvg) {
    toast('No diagram to export');
    return;
  }
  try {
    const blob = await svgToPngBlob(latestSvg, 2);
    downloadBlob(blob, 'regexray-diagram.png');
    toast('PNG downloaded');
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Export failed');
  }
});

// Boot from permalink or default example
const fromHash = decodePermalink(location.hash);
if (fromHash) {
  state.pattern = fromHash.pattern;
  state.flags = fromHash.flags;
  state.test = fromHash.test;
  state.activeExample = null;
  el.pattern.value = state.pattern;
  el.flags.value = state.flags;
  el.test.value = state.test;
}

window.addEventListener('hashchange', () => {
  const s = decodePermalink(location.hash);
  if (!s) return;
  state.pattern = s.pattern;
  state.flags = s.flags;
  state.test = s.test;
  state.activeExample = null;
  el.pattern.value = state.pattern;
  el.flags.value = state.flags;
  el.test.value = state.test;
  refresh({ skipPermalink: true });
});

refresh({ skipPermalink: !fromHash });
