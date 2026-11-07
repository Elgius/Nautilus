import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, getComputedStyle: dom.getComputedStyle.bind(dom), MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { LocalRoomFilePreview } = await import('../components/room/local-room-file');
const file = new File(['original local bytes'], 'local.txt', { type: 'text/plain' });
const entry = { id: 'local:test', source: 'local' as const, file };
const container = document.createElement('div'), actions = document.createElement('div');
document.body.append(container, actions);
let saves = 0, fetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => { fetches++; throw new Error('Preview must never upload'); }) as typeof fetch;
const root = createRoot(container);
try {
  await act(async () => { root.render(createElement(LocalRoomFilePreview, { entry, active: true, actionsContainer: actions, onRemove() {}, onSave() { saves++; } })); });
  assert.equal(fetches, 0); assert.equal(saves, 0);
  assert.match(container.textContent || '', /original local bytes/);
  const button = Array.from(actions.querySelectorAll('button')).find((button) => button.textContent?.includes('Save to room'))!;
  assert.ok(button);
  await act(async () => { button.click(); });
  assert.equal(saves, 1);
  await act(async () => { root.render(createElement(LocalRoomFilePreview, { entry, active: true, actionsContainer: actions, onRemove() {}, saved: true })); });
  assert.ok(Array.from(actions.querySelectorAll('button')).find((button) => button.textContent?.includes('Saved to room'))?.disabled);
  assert.equal(entry.file, file); assert.equal(fetches, 0);
  console.log('PASS: local preview makes no request; saving requires an explicit click; saved state retains the original File.');
} finally { await act(async () => { root.unmount(); }); globalThis.fetch = originalFetch; await dom.happyDOM.close(); }
