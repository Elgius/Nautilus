// Isolated DOM test: slow/failed history must never block content or the editor.
import assert from 'node:assert/strict';
// @ts-expect-error Bun supplies the isolated test runtime; web builds use Node types.
import { mock } from 'bun:test';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, getComputedStyle: dom.getComputedStyle.bind(dom), MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
let preloads = 0, contentRequests = 0, historyRequests = 0;
let resolveContent!: (response: Response) => void, resolveHistory!: (response: Response) => void;
mock.module('../components/room/univer-editor', () => ({
  preloadOfficeEditor: async (kind: string) => { assert.equal(kind, 'DOCUMENT'); preloads++; },
  default: () => createElement('div', { 'aria-label': 'Test editor' }, 'Document is visible'),
}));
const { RoomDocuments } = await import('../components/room/room-documents');
const { initialRoomFileState } = await import('../lib/room-file-state');
globalThis.fetch = (async (url: string | URL | Request) => {
  const path = String(url);
  if (path.endsWith('/content')) { contentRequests++; return new Promise<Response>((resolve) => { resolveContent = resolve; }); }
  if (path.endsWith('/versions')) { historyRequests++; return new Promise<Response>((resolve) => { resolveHistory = resolve; }); }
  if (path.endsWith('/attachments')) return Response.json({ attachments: [] });
  if (path.endsWith('/work')) return Response.json({ locked: false, queued: 0, activities: [], expiresAt: null, versions: { doc: 'v1' } });
  throw new Error(`Unexpected request ${path}`);
}) as typeof fetch;
const container = document.createElement('div'), actions = document.createElement('div');
document.body.append(container, actions);
const root = createRoot(container);
try {
  await act(async () => { root.render(createElement(RoomDocuments, {
    dirtyDocumentIds: new Set<string>(), navigationContainer: null, actionsContainer: actions, organizationId: 'org', roomId: 'room',
    initialDocuments: [{ id: 'doc', title: 'Brief', kind: 'DOCUMENT', category: '', status: 'DRAFT', currentVersionId: 'v1', updatedAt: '' }],
    storageConfigured: true, fileState: initialRoomFileState('doc'), dispatchFiles() {}, onSelect() {}, onDirtyChange() {},
  })); });
  assert.equal(preloads, 1, 'editor loading begins while content is still pending');
  assert.equal(contentRequests, 1);
  assert.equal(historyRequests, 0, 'opening a document does not fetch history');
  await act(async () => { resolveContent(Response.json({ content: { format: 'markdown', text: 'Brief' }, currentVersionId: 'v1' })); });
  assert.ok(container.querySelector('[aria-label="Test editor"]'), 'content renders without a history request');
  await act(async () => { actions.querySelector<HTMLButtonElement>('[aria-label="File menu"]')!.click(); });
  const historyButton = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent?.includes('Version history'))!;
  assert.ok(historyButton);
  await act(async () => { historyButton.click(); });
  assert.equal(historyRequests, 1);
  assert.match(document.body.textContent || '', /Loading version history/);
  assert.ok(container.querySelector('[aria-label="Test editor"]'), 'pending history does not hide the editor');
  await act(async () => { resolveHistory(Response.json({ error: 'History temporarily unavailable' }, { status: 503 })); });
  assert.match(document.body.textContent || '', /History temporarily unavailable/);
  assert.ok(container.querySelector('[aria-label="Test editor"]'), 'history failure does not hide the editor');
  await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent === 'Retry history')!.click(); });
  assert.equal(historyRequests, 2);
  await act(async () => { resolveHistory(Response.json({ versions: [], nextCursor: null })); });
  assert.match(document.body.textContent || '', /No saved versions yet/);
  assert.doesNotMatch(document.body.textContent || '', /History temporarily unavailable/);
  console.log('PASS: editor preload overlaps content, history is lazy, and slow/failed history preserves the editor with retry.');
} finally { await act(async () => { root.unmount(); }); await dom.happyDOM.close(); }
