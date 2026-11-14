// Run separately with Bun to isolate Univer and DOM mocks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mock } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
const dom = new GlobalWindow();
Object.assign(globalThis, { document: dom.document });
let frame;
globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
globalThis.cancelAnimationFrame = () => { frame = null; };
const viewport = { left: 10, top: 20, width: 560, height: 350, viewportScrollX: 0, viewportScrollY: 0 };
const position = { left: 100, top: 100, height: 20 };
class Documents {}
const render = {
  mainComponent: new Documents(),
  with: () => ({ getSkeleton: () => ({}) }),
  engine: { getCanvasElement: () => ({ getBoundingClientRect: () => ({ left: 40, top: 140 }) }) },
  scene: { ancestorScaleX: 1, ancestorScaleY: 1, getDefaultViewport: () => viewport },
};
mock.module('@univerjs/presets', () => ({ LocaleType: { EN_US: 'en-US' }, createUniver: () => ({
  univerAPI: { getActiveDocument: () => ({ id: 'doc' }) },
  univer: { __getInjector: () => ({ get: () => ({ getRenderUnitById: () => render }) }) },
}) }));
mock.module('@univerjs/preset-docs-core', () => ({
  Documents, DocSelectionManagerService: {}, DocSkeletonManagerService: {}, IRenderManagerService: {}, UniverDocsCorePreset: () => ({}),
  getTextRangeFromCharIndex: () => ({ getAbsolutePosition: () => position, dispose() {} }),
}));
mock.module('../components/room/univer-editor-core', () => ({ default: () => null }));
try {
  const { default: Editor } = await import('../components/room/univer-document-editor');
  const factory = Editor({}).props.createEditor;
  const host = document.createElement('div');
  host.getBoundingClientRect = () => ({ left: 40, top: 40, width: 600, height: 500 });
  document.body.append(host);
  const editor = factory(host);
  editor.streamCursor({ offset: 0, color: 'purple', label: 'Agent · requested by Alice' });
  frame();
  const overlay = host.querySelector('.document-stream-overlay');
  const marker = overlay.querySelector('.document-stream-cursor');
  assert.equal(overlay.style.left, '10px');
  assert.equal(overlay.style.top, '120px', 'clip starts below the header and toolbar, including viewport inset');
  assert.equal(overlay.style.width, '560px');
  assert.equal(overlay.style.height, '350px');
  assert.equal(marker.style.top, '80px');
  assert.equal(marker.hidden, false);
  const css = document.createElement('style');
  css.textContent = readFileSync(new URL('../components/room/univer-editor.css', import.meta.url), 'utf8');
  document.head.append(css);
  assert.equal(dom.getComputedStyle(overlay).overflow, 'hidden', 'one clipping parent contains both caret and attribution');
  assert.equal(marker.firstChild.textContent, 'Agent · requested by Alice');
  viewport.viewportScrollY = 110;
  frame();
  assert.equal(marker.hidden, true, 'insertion above the canvas is hidden even while inside the editor host');
  viewport.viewportScrollY = 90;
  frame();
  assert.equal(marker.hidden, false, 'partially visible caret is clipped at the top');
  assert.equal(marker.style.top, '-10px');
  viewport.viewportScrollY = 80;
  frame();
  assert.equal(marker.style.top, '0px', 'attribution above a caret at the viewport edge stays inside the clipping parent');
  viewport.viewportScrollY = 0;
  position.top = 365;
  frame();
  assert.equal(marker.hidden, false, 'partially visible caret is clipped at the bottom');
  position.top = 370;
  frame();
  assert.equal(marker.hidden, true, 'cursor below the viewport is hidden');
  position.top = 100;
  viewport.viewportScrollX = 100;
  frame();
  assert.equal(marker.hidden, true, 'cursor left of the viewport is hidden');
  viewport.viewportScrollX = 0;
  viewport.width = 300;
  frame();
  assert.equal(overlay.style.width, '300px', 'clip follows viewport resizing');
  editor.streamCursor(null);
  assert.equal(host.childElementCount, 0, 'completion removes the entire overlay');
  assert.equal(frame, null);
  console.log('PASS: document viewport bounds, scrolling, caret and attribution clipping, resize, cleanup.');
} finally { mock.restore(); await dom.happyDOM.close(); }
