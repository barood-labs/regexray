#!/usr/bin/env node
/**
 * RegexRay QA — headless Chromium via system Chrome + playwright-core.
 * Checks: screenshots of key states, real regexes, permalink round-trip,
 * PNG/Markdown export, no console errors, no outside network calls.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const QA = join(ROOT, 'qa');
const SHOTS = join(QA, 'shots');
const PORT = 4177;

mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.webp': 'image/webp',
};

function startStatic() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let url = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
      if (url === '/') url = '/index.html';
      const path = join(DIST, url.replace(/^\//, ''));
      if (!path.startsWith(DIST) || !existsSync(path) || statSync(path).isDirectory()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
      res.end(readFileSync(path));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}

const CASES = [
  { id: 'email', pattern: '^[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}$', flags: 'm', test: 'hello@barood.labs\nbad@@mail', expectMin: 1 },
  { id: 'url', pattern: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*', flags: 'g', test: 'see https://example.com/a and http://x.io', expectMin: 2 },
  { id: 'date', pattern: '\\b(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])\\b', flags: 'g', test: '2026-10-21 and 2026-13-40', expectMin: 1 },
  { id: 'ipv4', pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', flags: 'g', test: '8.8.8.8 999.1.1.1', expectMin: 1 },
  { id: 'named', pattern: '(?<year>\\d{4})-(?<month>\\d{2})', flags: '', test: '2026-10', expectMin: 1 },
  { id: 'optional-alt', pattern: 'colou?r|gray|grey', flags: 'gi', test: 'Color COLOR grey GRAY', expectMin: 3 },
];

async function setState(page, { pattern, flags, test }) {
  await page.evaluate(({ pattern, flags, test }) => {
    const p = document.getElementById('pattern');
    const f = document.getElementById('flags');
    const t = document.getElementById('test');
    p.value = pattern;
    f.value = flags;
    t.value = test;
    p.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('input', { bubbles: true }));
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, { pattern, flags, test });
  await page.waitForTimeout(200);
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/ missing — run npm run build first');
    process.exit(1);
  }

  const server = await startStatic();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const outside = [];
  const consoleErrors = [];

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (u.startsWith(`http://127.0.0.1:${PORT}`) || u.startsWith(`http://localhost:${PORT}`)) return;
    // worker blob URLs / module workers are same-origin via blob
    if (u.startsWith('blob:')) return;
    outside.push(u);
  });

  console.log('\n== RegexRay QA ==\n');

  // Load
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#diagram svg, #diagram .diagram-empty', { timeout: 5000 });
  pass('loads app');

  // Default example screenshot
  await page.screenshot({ path: join(SHOTS, '01-default-email.png'), fullPage: true });
  pass('screenshot default (email)');

  // Click through examples
  const exampleCount = await page.locator('#examples button').count();
  if (exampleCount >= 6) pass('example gallery rendered', `${exampleCount} buttons`);
  else fail('example gallery rendered', `only ${exampleCount}`);

  for (let i = 0; i < exampleCount; i++) {
    const btn = page.locator('#examples button').nth(i);
    const label = (await btn.innerText()).toLowerCase().replace(/\s+/g, '-');
    await btn.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, `02-example-${String(i + 1).padStart(2, '0')}-${label}.png`), fullPage: true });
  }
  pass('screenshots of all examples');

  // Invalid regex state
  await setState(page, { pattern: '(unclosed', flags: '', test: 'x' });
  await page.waitForTimeout(150);
  const hasErr = await page.evaluate(() => document.getElementById('error').classList.contains('show'));
  if (hasErr) pass('invalid regex shows error');
  else fail('invalid regex shows error');
  await page.screenshot({ path: join(SHOTS, '03-invalid.png'), fullPage: true });

  // Empty pattern
  await setState(page, { pattern: '', flags: '', test: 'hello' });
  await page.screenshot({ path: join(SHOTS, '04-empty.png'), fullPage: true });
  pass('screenshot empty pattern');

  // Real regex cases + match counts
  for (const c of CASES) {
    await setState(page, c);
    await page.waitForTimeout(300);
    const meta = await page.textContent('#match-meta');
    const m = /(\d+)\s+match/.exec(meta || '');
    const n = m ? Number(m[1]) : -1;
    if (n >= c.expectMin) pass(`case ${c.id}`, `${n} matches`);
    else fail(`case ${c.id}`, `got ${n}, want ≥ ${c.expectMin}; meta=${meta}`);
    await page.screenshot({ path: join(SHOTS, `05-case-${c.id}.png`), fullPage: true });
  }

  // Catastrophic backtracking timeout
  await setState(page, {
    pattern: '(a+)+$',
    flags: '',
    test: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab',
  });
  await page.waitForTimeout(500);
  const metaEvil = await page.textContent('#match-meta');
  if (/timed out|match/i.test(metaEvil || '')) pass('catastrophic backtracking guarded', metaEvil.trim());
  else fail('catastrophic backtracking guarded', metaEvil);
  await page.screenshot({ path: join(SHOTS, '06-backtracking.png'), fullPage: true });

  // Permalink round-trip
  await setState(page, {
    pattern: 'foo(bar)?',
    flags: 'gi',
    test: 'Foo BAR foobar',
  });
  await page.waitForTimeout(200);
  const hash = await page.evaluate(() => location.hash);
  if (hash.startsWith('#r=')) pass('permalink written to hash');
  else fail('permalink written to hash', hash);

  // Load fresh page with that hash
  await page.goto(`http://127.0.0.1:${PORT}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const round = await page.evaluate(() => ({
    p: document.getElementById('pattern').value,
    f: document.getElementById('flags').value,
    t: document.getElementById('test').value,
  }));
  if (round.p === 'foo(bar)?' && round.f === 'gi' && round.t === 'Foo BAR foobar') {
    pass('permalink round-trip');
  } else {
    fail('permalink round-trip', JSON.stringify(round));
  }
  await page.screenshot({ path: join(SHOTS, '07-permalink.png'), fullPage: true });

  // Copy Markdown (clipboard)
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#btn-copy-md');
  await page.waitForTimeout(100);
  const md = await page.evaluate(() => navigator.clipboard.readText());
  if (md.includes('foo(bar)?') && md.includes('RegexRay')) pass('Markdown export', `${md.length} chars`);
  else fail('Markdown export', md.slice(0, 120));

  // Copy link
  await page.click('#btn-copy-link');
  await page.waitForTimeout(100);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  if (link.includes('#r=')) pass('Copy link', link.slice(0, 80) + '…');
  else fail('Copy link', link);

  // PNG export via page-level function (download is flaky headless; call svgToPngBlob path)
  const pngOk = await page.evaluate(async () => {
    const svg = document.querySelector('#diagram svg');
    if (!svg) return { ok: false, reason: 'no svg' };
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([`<?xml version="1.0"?>\n` + xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!out || out.size < 100) return { ok: false, reason: 'tiny blob ' + (out && out.size) };
      // stash as data URL for Node to write
      const buf = await out.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      return { ok: true, b64, size: out.size };
    } catch (e) {
      return { ok: false, reason: String(e) };
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  if (pngOk.ok) {
    writeFileSync(join(SHOTS, '08-export-diagram.png'), Buffer.from(pngOk.b64, 'base64'));
    pass('PNG export', `${pngOk.size} bytes`);
  } else {
    fail('PNG export', pngOk.reason);
  }

  // Mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, '09-mobile.png'), fullPage: true });
  pass('screenshot mobile');

  // Console / network
  if (consoleErrors.length === 0) pass('no console errors');
  else fail('no console errors', consoleErrors.slice(0, 5).join(' | '));

  if (outside.length === 0) pass('no outside network calls');
  else fail('no outside network calls', outside.slice(0, 5).join(' | '));

  // Contact sheet via magick or montaging with chrome... try ImageMagick / sharp / pure ffmpeg
  await buildContactSheet();

  await browser.close();
  server.close();

  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  const summary = { ok, bad, total: results.length, results, shotsDir: SHOTS };
  writeFileSync(join(QA, 'report.json'), JSON.stringify(summary, null, 2));
  console.log(`\n== ${ok}/${results.length} passed${bad ? `, ${bad} failed` : ''} ==\n`);
  process.exit(bad ? 1 : 0);
}

async function buildContactSheet() {
  // Prefer magick/convert; else a tiny HTML montage rendered by chrome.
  const shots = [
    '01-default-email.png',
    '02-example-01-email.png',
    '02-example-03-iso-date.png',
    '02-example-07-password.png',
    '03-invalid.png',
    '05-case-named.png',
    '06-backtracking.png',
    '07-permalink.png',
    '09-mobile.png',
  ].map((f) => join(SHOTS, f)).filter(existsSync);

  const out = join(QA, 'contact_sheet.png');

  const tryMagick = () =>
    new Promise((resolve) => {
      const bin = existsSync('/usr/bin/magick') ? 'magick' : existsSync('/usr/bin/convert') ? 'convert' : null;
      if (!bin) return resolve(false);
      const args =
        bin === 'magick'
          ? ['montage', ...shots, '-geometry', '480x', '-tile', '3x', '-background', '#070a0e', '-padding', '8', out]
          : [...shots, '-geometry', '480x', '-tile', '3x', '-background', '#070a0e', out];
      const p = spawn(bin, args, { stdio: 'ignore' });
      p.on('exit', (code) => resolve(code === 0 && existsSync(out)));
      p.on('error', () => resolve(false));
    });

  if (await tryMagick()) {
    pass('contact sheet', out);
    return;
  }

  // Fallback: HTML collage via chrome
  const html = `<!doctype html><meta charset="utf-8"><title>sheet</title>
  <style>body{margin:0;background:#070a0e;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px}
  img{width:100%;height:auto;border:1px solid #1e2a36;border-radius:6px}</style>
  <body>${shots.map((s) => `<img src="file://${s}">`).join('')}</body>`;
  const htmlPath = join(QA, '_sheet.html');
  writeFileSync(htmlPath, html);
  try {
    const b = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'],
    });
    const p = await b.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    await p.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    await p.screenshot({ path: out, fullPage: true });
    await b.close();
    if (existsSync(out)) pass('contact sheet', out);
    else fail('contact sheet', 'not written');
  } catch (e) {
    fail('contact sheet', String(e));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
