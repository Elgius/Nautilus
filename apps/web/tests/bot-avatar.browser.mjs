// Exercise the React adapter and real canvas renderer without paid model requests.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const { buildSync } = createRequire(new URL('../../server/package.json', import.meta.url))('esbuild');
const output = mkdtempSync(join(tmpdir(), 'nautilus-avatar-'));
buildSync({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { AgentShape } from './components/agents/agent-portrait';
    import { getExample } from 'open-bot-avatar';
    const root = createRoot(document.getElementById('root'));
    window.showAvatar = (options = {}) => root.render(
      <React.StrictMode><div className="create-agent-preview"><AgentShape shape="circle"
        design={{ definition: getExample(options.id || 'mug'), color: options.color || '#ff6a1a' }}
        animated={options.animated !== false} mood={options.mood || 'idle'} /></div></React.StrictMode>
    );
    window.removeAvatar = () => root.unmount();
    window.showAvatar();
  `, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  bundle: true, outfile: join(output, 'bundle.js'), format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
});
const css = readFileSync(new URL('../app/agent-naming.css', import.meta.url), 'utf8');
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  if (new URL(request.url).pathname === '/bundle.js') return new Response(readFileSync(join(output, 'bundle.js')), { headers: { 'Content-Type': 'application/javascript' } });
  return new Response(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html' } });
} });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForSelector('canvas');
  const size = await page.locator('.bot-avatar').boundingBox();
  assert.equal(size.width, 118, 'preview keeps the established square size');
  assert.equal(size.height, 118);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0);
  });
  // Keep a live canvas mounted: the system preference must stop idle motion by itself.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
  const resting = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(250);
  assert.equal(await page.locator('canvas').evaluate(canvas => canvas.toDataURL()), resting, 'reduced motion stops idle animation on the live canvas');

  // With idle motion disabled, the dark eyes must move toward the pointer.
  // Measure in page coordinates because the canvas bitmap can change its bounds.
  await page.evaluate(() => {
    window.eyeCenter = () => {
      const canvas = document.querySelector('canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 200 && data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) {
          total += (i / 4) % canvas.width;
          count++;
        }
      }
      const rect = canvas.getBoundingClientRect();
      return count ? rect.left + total / count * rect.width / canvas.width : NaN;
    };
  });
  await page.mouse.move(0, size.y + size.height / 2);
  await page.waitForTimeout(150);
  const left = await page.evaluate(() => window.eyeCenter());
  assert.ok(Number.isFinite(left), 'eyes are visible');
  await page.mouse.move(899, size.y + size.height / 2);
  await page.waitForFunction(left => window.eyeCenter() > left + 0.5, left);
  await page.waitForTimeout(150);
  const right = await page.evaluate(() => window.eyeCenter());
  await page.mouse.move(0, size.y + size.height / 2);
  await page.waitForFunction(right => window.eyeCenter() < right - 0.5, right);

  // Re-enabling motion must resume idle animation without remounting.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const before = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await page.waitForFunction(before => document.querySelector('canvas').toDataURL() !== before, before);
  await page.evaluate(() => { window.originalCanvas = document.querySelector('canvas'); window.showAvatar({ color: '#00cd82', mood: 'happy' }); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bot-avatar')).color === 'rgb(0, 205, 130)');
  assert.equal(await page.evaluate(() => window.originalCanvas === document.querySelector('canvas')), true, 'recoloring and mood changes preserve the renderer');
  await page.evaluate(() => window.showAvatar({ animated: false }));
  await page.waitForSelector('.bot-avatar > svg');
  assert.equal(await page.locator('canvas').count(), 0, 'small/static avatars render as SVG');
  assert.ok(await page.locator('.bot-avatar svg use').count() > 1, 'static output includes volume slices');
  await page.evaluate(() => window.showAvatar({ id: 'controller' }));
  await page.waitForSelector('canvas');
  await page.evaluate(() => window.removeAvatar());
  assert.equal(await page.locator('.bot-avatar').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Avatar browser checks passed: canvas paint, square sizing, pointer motion, recoloring, moods, static SVG, reduced motion, and cleanup.');
} finally {
  await browser?.close();
  server.stop(true);
  rmSync(output, { recursive: true, force: true });
}
