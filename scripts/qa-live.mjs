#!/usr/bin/env node
/** Live QA against the GitHub Pages deploy. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIVE = process.env.REGEXRAY_URL || 'https://barood-labs.github.io/regexray/';
const QA = join(__dirname, '..', 'qa', 'live');
mkdirSync(QA, { recursive: true });

const results = [];
const pass = (n, d = '') => { results.push({ ok: true, n, d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); };
const fail = (n, d = '') => { results.push({ ok: false, n, d }); console.error(`  ✗ ${n}${d ? ' — ' + d : ''}`); };

async function setState(page, { pattern, flags, test }) {
  await page.evaluate(({ pattern, flags, test }) => {
    const p = document.getElementById('pattern');
    const f = document.getElementById('flags');
    const t = document.getElementById('test');
    p.value = pattern; f.value = flags; t.value = test;
    p.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('input', { bubbles: true }));
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, { pattern, flags, test });
  await page.waitForTimeout(250);
}

async function main() {
  console.log(`\n== RegexRay LIVE QA ==\n${LIVE}\n`);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const outside = [];
  const consoleErrors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    // Allow only our Pages origin + GitHub Pages CDN-less same host
    if (u.startsWith('https://barood-labs.github.io/regexray')) return;
    // Chrome internals
    if (u.startsWith('https://barood-labs.github.io/')) return; // favicon etc under same site
    outside.push(u);
  });

  await page.goto(LIVE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#diagram svg, #diagram .diagram-empty', { timeout: 10000 });
  pass('loads live site');
  await page.screenshot({ path: join(QA, '01-default.png'), fullPage: true });

  // Examples
  const nEx = await page.locator('#examples button').count();
  if (nEx >= 6) pass('example gallery', `${nEx}`); else fail('example gallery', String(nEx));
  for (let i = 0; i < nEx; i++) {
    const btn = page.locator('#examples button').nth(i);
    await btn.click();
    await page.waitForTimeout(300);
    const svg = await page.locator('#diagram svg').count();
    if (svg < 1 && i < nEx) { /* password etc should have svg */ }
  }
  // Pick date specifically
  await page.locator('#examples button', { hasText: 'ISO date' }).click();
  await page.waitForTimeout(400);
  const hasSvg = await page.locator('#diagram svg').count();
  if (hasSvg) pass('diagram renders for ISO date'); else fail('diagram renders for ISO date');
  const meta = await page.textContent('#match-meta');
  if (/\d+\s+match/.test(meta || '')) pass('live matches', meta.trim()); else fail('live matches', meta);

  // Permalink round-trip
  await setState(page, { pattern: 'foo(bar)?', flags: 'gi', test: 'Foo BAR foobar' });
  await page.waitForTimeout(300);
  const hash = await page.evaluate(() => location.hash);
  if (hash.startsWith('#r=')) pass('permalink written'); else fail('permalink written', hash);
  await page.goto(LIVE + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const round = await page.evaluate(() => ({
    p: document.getElementById('pattern').value,
    f: document.getElementById('flags').value,
    t: document.getElementById('test').value,
  }));
  if (round.p === 'foo(bar)?' && round.f === 'gi' && round.t === 'Foo BAR foobar') pass('permalink round-trip');
  else fail('permalink round-trip', JSON.stringify(round));
  await page.screenshot({ path: join(QA, '02-permalink.png'), fullPage: true });

  // Markdown
  await page.click('#btn-copy-md');
  await page.waitForTimeout(150);
  const md = await page.evaluate(() => navigator.clipboard.readText());
  if (md.includes('foo(bar)?') && /RegexRay/i.test(md)) pass('Markdown export'); else fail('Markdown export', md.slice(0, 100));

  // PNG export (in-page canvas path)
  const pngOk = await page.evaluate(async () => {
    const svg = document.querySelector('#diagram svg');
    if (!svg) return { ok: false, reason: 'no svg' };
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([`<?xml version="1.0"?>\n` + xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, img.width * 2); canvas.height = Math.max(2, img.height * 2);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      return { ok: !!(out && out.size > 100), size: out?.size || 0 };
    } catch (e) { return { ok: false, reason: String(e) }; }
    finally { URL.revokeObjectURL(url); }
  });
  if (pngOk.ok) pass('PNG export', `${pngOk.size} bytes`); else fail('PNG export', pngOk.reason || '');

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LIVE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(QA, '03-mobile.png'), fullPage: true });
  pass('mobile screenshot');

  // Network / console — filter known GH pages noise? Should be zero outside.
  // Service workers / extensions none. Allow nothing outside barood-labs.github.io
  const badOutside = outside.filter((u) => !u.startsWith('https://barood-labs.github.io/'));
  if (badOutside.length === 0) pass('no outside network calls', `${outside.length} same-origin reqs`);
  else fail('no outside network calls', badOutside.slice(0, 6).join(' | '));

  if (consoleErrors.length === 0) pass('no console errors');
  else fail('no console errors', consoleErrors.slice(0, 4).join(' | '));

  await browser.close();
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  writeFileSync(join(QA, 'report.json'), JSON.stringify({ live: LIVE, ok, bad, results }, null, 2));
  console.log(`\n== LIVE ${ok}/${results.length} passed${bad ? `, ${bad} failed` : ''} ==\n`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
