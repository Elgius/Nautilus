// Run with Bun: installed Univer editors in real Chromium, without external services.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { officeContent } from '../lib/office-content';

const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { buildSync } = requireServer('esbuild');
const output = mkdtempSync(join(tmpdir(), 'nautilus-selection-'));
const doc = officeContent('DOCUMENT', 'selection-doc', 'Selection document', { format: 'markdown', text: 'Selected passage\nAnother paragraph' });
const sheet = officeContent('SPREADSHEET', 'selection-sheet', 'Selection workbook', { format: 'spreadsheet', sheets: [{ id: 1, name: 'Budget', cells: [['Item', 'Cost'], ['Travel', '125']] }], styles: {} });
buildSync({
  stdin: { contents: `
    import DocumentEditor from './components/room/univer-document-editor';
    import SpreadsheetEditor from './components/room/univer-spreadsheet-editor';
    window.quotes = [];
    let editor, subscription;
    window.mountEditor = (kind, content) => {
      subscription?.dispose();
      editor?.univer.dispose();
      document.querySelector('#editor').replaceChildren();
      const Component = kind === 'doc' ? DocumentEditor : SpreadsheetEditor;
      editor = Component({}).props.createEditor(document.querySelector('#editor'));
      if (kind === 'doc') editor.univerAPI.createDocument(content.snapshot);
      else editor.univerAPI.createWorkbook(content.snapshot);
      subscription = editor.observeSelection(quote => window.quotes.push(quote));
      window.api = editor.univerAPI;
      window.stopObserving = () => subscription.dispose();
    };
  `, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'js' },
  bundle: true, outfile: join(output, 'bundle.js'), format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
});
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/bundle.js' || path === '/bundle.css') return new Response(readFileSync(join(output, path.slice(1))), { headers: { 'Content-Type': path.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8' } });
  return new Response('<!doctype html><html><head><link rel="stylesheet" href="/bundle.css"></head><body><div id="editor" style="height:700px"></div><script src="/bundle.js"></script></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
} });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.goto(`http://127.0.0.1:${server.port}`);
  assert.deepEqual(errors, []);
  await page.evaluate(content => window.mountEditor('doc', content), doc);
  await page.waitForSelector('canvas');
  await page.evaluate(() => window.api.getActiveDocument().setSelection(0, 16));
  await page.waitForFunction(() => window.quotes.length > 0);
  assert.equal(await page.evaluate(() => window.quotes.at(-1).text), 'Selected passage');
  assert.match(await page.evaluate(() => window.quotes.at(-1).location), /characters 0–16/);
  const count = await page.evaluate(() => window.quotes.length);
  await page.evaluate(() => window.api.getActiveDocument().setSelection(16, 16));
  assert.equal(await page.evaluate(() => window.quotes.length), count, 'a collapsed caret does not replace a quote');
  await page.evaluate(() => { window.stopObserving(); window.api.getActiveDocument().setSelection(0, 8); });
  assert.equal(await page.evaluate(() => window.quotes.length), count, 'selection subscriptions are disposed');
  await page.evaluate(content => window.mountEditor('sheet', content), sheet);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.quotes.length), count, 'opening a sheet does not attach its initial cell');
  await page.evaluate(() => {
    document.querySelector('#editor').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const worksheet = window.api.getActiveWorkbook().getActiveSheet();
    worksheet.setActiveRange(worksheet.getRange('A1:B2'));
  });
  await page.waitForFunction(previous => window.quotes.length > previous, count);
  const quote = await page.evaluate(() => window.quotes.at(-1));
  assert.equal(quote.text, 'Item\tCost\nTravel\t125');
  assert.match(quote.location, /Budget!.*A1:B2/);
  await page.evaluate(() => { const worksheet = window.api.getActiveWorkbook().getActiveSheet(); worksheet.setActiveRange(worksheet.getRange('A1:Z100')); });
  await page.waitForFunction(() => window.quotes.at(-1).truncated === true);
  assert.ok((await page.evaluate(() => window.quotes.at(-1).text.length)) <= 6000);
  assert.deepEqual(errors, []);
  console.log('PASS: native document selection, collapsed caret, subscription cleanup, spreadsheet range values and bounded large selections.');
} finally { await browser?.close(); await server.stop(true); }
