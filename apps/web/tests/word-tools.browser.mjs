// Run with Bun. Real Chromium + the installed Univer editor; no database or model calls.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { officeContent } from '../lib/office-content';
import { applyDocumentEdits, readTable } from '../../office/src/editing/docs';

const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { buildSync } = requireServer('esbuild');
const output = mkdtempSync(join(tmpdir(), 'nautilus-word-browser-'));
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const base = officeContent('DOCUMENT', 'word-browser', 'Whale sizes', { format: 'markdown', text: 'Whale sizes\nApproximate adult lengths.\nKeep this paragraph.' });
const next = applyDocumentEdits(base, [
  { type: 'insertTable', index: 38, cells: [['Whale', 'Approximate length'], ['Blue whale', '24–30 m'], ['Humpback whale', '12–16 m']], headerRow: true },
  { type: 'formatFont', start: 0, end: 11, style: { fontFamily: 'Arial', fontSize: 22, bold: true } },
]);
const tableId = next.snapshot.body.tables[0].tableId;
const edited = applyDocumentEdits(next, [{ type: 'setTableCell', tableId, row: 1, column: 1, expectedText: '24–30 m', text: 'Approximately 24–30 m' }]);
buildSync({
  stdin: { contents: `
    import { createUniver, LocaleType } from '@univerjs/presets';
    import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
    import DocsEnUS from '@univerjs/preset-docs-core/locales/en-US';
    import '@univerjs/preset-docs-core/lib/index.css';
    import { updateUniverDocument } from './lib/univer-document-update';
    const editor = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: DocsEnUS }, presets: [UniverDocsCorePreset({ container: 'editor' })] });
    window.applySaved = (content) => updateUniverDocument(editor.univerAPI, content);
    window.editor = editor;
    fetch('/base').then(r => r.json()).then(base => {
      window.documentUnit = editor.univerAPI.createDocument(base.snapshot);
      window.ready = true;
    });
  `, resolveDir: webRoot, loader: 'js' },
  bundle: true, outfile: join(output, 'bundle.js'), format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
});
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/base') return Response.json(base);
  if (path === '/bundle.js') return new Response(readFileSync(join(output, 'bundle.js')), { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
  if (path === '/bundle.css') return new Response(readFileSync(join(output, 'bundle.css')), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
  return new Response('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css"></head><body style="margin:0"><div id="editor" style="height:100vh"></div><script src="/bundle.js"></script></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
} });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.waitForFunction(() => window.ready && document.querySelector('canvas'));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(content => window.applySaved(content), next), true);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.editor.univerAPI.getActiveDocument().getDocumentDataModel() === window.documentUnit.getDocumentDataModel()), true);
  assert.equal(await page.evaluate(content => window.applySaved(content), edited), true);
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => window.editor.univerAPI.getActiveDocument().save());
  assert.equal(readTable({ ...edited, snapshot: saved }, tableId).rows[1][1].text, 'Approximately 24–30 m');
  assert.ok(saved.body.dataStream.includes('Keep this paragraph.'));
  assert.equal(errors.length, 0, errors.join('\n'));
  const screenshot = join(output, 'native-word-table.png');
  await page.screenshot({ path: screenshot });
  console.log(`PASS: real Univer canvas receives native table and font updates, then a cell edit, without replacing its document unit. Screenshot: ${screenshot}`);
} finally { await browser?.close(); server.stop(true); }
