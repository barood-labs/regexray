#!/usr/bin/env node
/**
 * Silent RegexRay demo — Playwright video → H.264 MP4 with on-screen captions.
 * No voiceover. Drives Chromium at 1280×720 (and optional 1080×1920).
 */
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import { mkdirSync, existsSync, rmSync, renameSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const PROMO = join(ROOT, 'promo');
const TMP = join(PROMO, '_demo_tmp');
const PORT = 4188;

mkdirSync(PROMO, { recursive: true });
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

function startStatic() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let url = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
      if (url === '/') url = '/index.html';
      const path = join(DIST, url.replace(/^\//, ''));
      if (!path.startsWith(DIST) || !existsSync(path) || statSync(path).isDirectory()) {
        res.writeHead(404); res.end('missing'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' });
      res.end(readFileSync(path));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function injectChrome(page) {
  await page.addStyleTag({ content: `
    #demo-caption {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
      z-index: 99999; pointer-events: none;
      background: rgba(7,10,14,0.88); color: #e7eef7;
      border: 1px solid #2dd4bf66; border-radius: 999px;
      padding: 10px 22px; font: 600 16px/1.3 "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.01em; box-shadow: 0 12px 40px rgba(0,0,0,0.45);
      max-width: 90vw; text-align: center;
      opacity: 0; transition: opacity .25s ease;
    }
    #demo-caption.show { opacity: 1; }
    #demo-cursor {
      position: fixed; width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid #5eead4; background: rgba(94,234,212,0.25);
      box-shadow: 0 0 0 4px rgba(94,234,212,0.12), 0 4px 12px rgba(0,0,0,0.4);
      z-index: 100000; pointer-events: none; transform: translate(-50%, -50%);
      left: -100px; top: -100px; transition: left .08s linear, top .08s linear;
    }
    #demo-cursor.clicking { transform: translate(-50%, -50%) scale(0.85); background: rgba(251,191,36,0.45); border-color: #fbbf24; }
  `});
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = 'demo-caption'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'demo-cursor'; document.body.appendChild(k);
    window.__caption = (t) => { c.textContent = t; c.classList.add('show'); };
    window.__captionHide = () => c.classList.remove('show');
    window.__cursor = (x, y) => { k.style.left = x + 'px'; k.style.top = y + 'px'; };
    window.__clickPulse = async () => {
      k.classList.add('clicking');
      await new Promise((r) => setTimeout(r, 120));
      k.classList.remove('clicking');
    };
  });
}

async function caption(page, text, holdMs = 1600) {
  await page.evaluate((t) => window.__caption(t), text);
  await sleep(holdMs);
}

async function moveCursor(page, x, y, steps = 12) {
  // animate via evaluate for visible cursor + real mouse for hover
  const cur = await page.evaluate(() => {
    const k = document.getElementById('demo-cursor');
    return { x: parseFloat(k.style.left) || 40, y: parseFloat(k.style.top) || 40 };
  });
  for (let i = 1; i <= steps; i++) {
    const nx = cur.x + (x - cur.x) * (i / steps);
    const ny = cur.y + (y - cur.y) * (i / steps);
    await page.evaluate(({ nx, ny }) => window.__cursor(nx, ny), { nx, ny });
    await page.mouse.move(nx, ny);
    await sleep(16);
  }
}

async function clickAt(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error('no box for ' + selector);
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 18);
  await moveCursor(page, x, y);
  await page.evaluate(() => window.__clickPulse());
  await page.mouse.click(x, y);
  await sleep(200);
}

async function typeSlow(page, selector, text, perChar = 55) {
  await clickAt(page, selector);
  // clear
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 0 });
    await sleep(perChar + Math.random() * 30);
  }
}

async function runScenario(page) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await injectChrome(page);
  await page.evaluate(() => window.__cursor(200, 160));
  await sleep(600);

  // Start clean
  await page.evaluate(() => {
    for (const id of ['pattern', 'flags', 'test']) {
      const el = document.getElementById(id);
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(400);

  await caption(page, 'RegexRay — see your regex', 2000);

  await caption(page, '1 · Paste a pattern', 900);
  const email = String.raw`^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$`;
  await typeSlow(page, '#pattern', email, 40);
  // enable m flag
  await clickAt(page, '.chip[data-flag="m"]');
  await sleep(800);
  await caption(page, 'Railroad diagram draws itself', 2200);

  await caption(page, '2 · Type a test string', 900);
  await typeSlow(page, '#test', 'hello@barood.labs\nbad@@mail\nme@x.io', 35);
  await sleep(600);
  await caption(page, 'Live matches + groups highlight', 2200);

  // Scroll explain into view / hover tokens
  await caption(page, '3 · Every token in plain English', 900);
  const explainBox = await page.locator('#explain').boundingBox();
  if (explainBox) {
    await moveCursor(page, explainBox.x + 80, explainBox.y + 40);
    await sleep(400);
    await moveCursor(page, explainBox.x + 100, explainBox.y + 120, 18);
  }
  await sleep(1600);

  await caption(page, '4 · One-tap examples', 900);
  await clickAt(page, '#examples button:nth-child(3)'); // ISO date
  await sleep(1800);
  await caption(page, 'ISO date — diagram, matches, explanation', 2000);

  await caption(page, '5 · Share a permalink — no backend', 1000);
  await clickAt(page, '#btn-copy-link');
  await sleep(1600);

  await caption(page, '6 · Export the diagram as PNG', 1000);
  await clickAt(page, '#btn-export-png');
  await sleep(1800);

  await caption(page, 'Free · offline · no account · by barood-labs', 2600);
  await page.evaluate(() => window.__captionHide());
  await sleep(700);
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('exit', (code) => (code === 0 ? resolve(err) : reject(new Error(err.slice(-800)))));
  });
}

async function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => resolve(parseFloat(out.trim()) || 0));
  });
}

async function recordOne({ width, height, outName }) {
  const videoDir = join(TMP, `${width}x${height}`);
  mkdirSync(videoDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width, height } },
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  console.log(`  recording ${width}×${height}…`);
  await runScenario(page);
  const vidPath = await page.video().path();
  await context.close();
  await browser.close();

  const webm = vidPath;
  const mp4 = join(PROMO, outName);
  console.log(`  encoding ${outName}…`);
  await ffmpeg([
    '-i', webm,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '20',
    '-movflags', '+faststart',
    '-an',
    mp4,
  ]);
  const dur = await probeDuration(mp4);
  console.log(`  ✓ ${mp4} (${dur.toFixed(1)}s)`);
  return { path: mp4, duration: dur };
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/ missing — build first');
    process.exit(1);
  }
  const server = await startStatic();
  try {
    const landscape = await recordOne({ width: 1280, height: 720, outName: 'regexray_demo.mp4' });
    // Vertical variant — taller captions-friendly walkthrough
    const portrait = await recordOne({ width: 1080, height: 1920, outName: 'regexray_demo_vertical.mp4' });
    const summary = { landscape, portrait, createdAt: new Date().toISOString() };
    writeFileSync(join(PROMO, 'demo_meta.json'), JSON.stringify(summary, null, 2));
    console.log('\nDemo done:', JSON.stringify(summary, null, 2));
  } finally {
    server.close();
    try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
