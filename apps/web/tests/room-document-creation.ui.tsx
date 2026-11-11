import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, getComputedStyle: dom.getComputedStyle.bind(dom), MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RoomDocuments } = await import('../components/room/room-documents');
const file = new File(['local unsaved bytes'], 'local.txt', { type: 'text/plain' });
const entry = { id: 'local:test', source: 'local' as const, file };
const container = document.createElement('div'), navigation = document.createElement('div'), actions = document.createElement('div');
document.body.append(container, navigation, actions);
let resolveMetadata!: (response: Response) => void;
let metadataRequests = 0, mutations = 0, selections = 0;
const originalFetch = globalThis.fetch;
const work = { locked: false, queued: 0, activities: [], expiresAt: null, versions: {} };
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (init?.method && init.method !== 'GET') mutations++;
  if (String(url).endsWith('/work')) return Response.json(work);
  if (String(url).endsWith('/attachments')) return Response.json({ attachments: [] });
  if (String(url).endsWith('/documents')) { metadataRequests++; return new Promise<Response>((resolve) => { resolveMetadata = resolve; }); }
  throw new Error(`Unexpected request ${String(url)}`);
}) as typeof fetch;
const root = createRoot(container);
const update = (roomId: string) => window.dispatchEvent(new window.CustomEvent('room-work-update', {
  detail: { organizationId: 'org', roomId, work: { ...work, versions: { created: 'v1' } } },
}));
try {
  await act(async () => { root.render(createElement(RoomDocuments, {
    dirtyDocumentIds: new Set<string>(), navigationContainer: navigation, actionsContainer: actions,
    organizationId: 'org', roomId: 'room', initialDocuments: [], storageConfigured: false,
    fileState: { files: [entry], selectedId: entry.id, openIds: [entry.id], visitedIds: [entry.id], uploadOpen: false, error: '' },
    dispatchFiles() {}, onSelect() { selections++; }, onDirtyChange() {},
  })); });
  assert.match(container.textContent || '', /local unsaved bytes/);
  const preview = container.querySelector(`#file-panel-${entry.id.replace(':', '\\:')}`);
  await act(async () => { update('other-room'); });
  assert.equal(metadataRequests, 0);
  await act(async () => { update('room'); });
  assert.equal(metadataRequests, 1);
  // Repeated events must not abort or restart an in-flight metadata fetch.
  await act(async () => { update('room'); update('room'); });
  assert.equal(metadataRequests, 1);
  await act(async () => { resolveMetadata(Response.json({ documents: [{ id: 'created', title: 'Agent brief', kind: 'DOCUMENT', category: 'Notes', status: 'DRAFT', currentVersionId: 'v1', updatedAt: new Date().toISOString() }] })); });
  await act(async () => { (navigation.querySelector('[aria-label="Browse room files"]') as HTMLButtonElement).click(); });
  assert.match(document.body.textContent || '', /Agent brief/);
  assert.match(document.body.textContent || '', /local.txt/);
  assert.equal(container.querySelector(`#file-panel-${entry.id.replace(':', '\\:')}`), preview);
  assert.equal(entry.file, file);
  assert.equal(mutations, 0); assert.equal(selections, 0);
  await act(async () => { update('room'); });
  assert.equal(metadataRequests, 1, 'known IDs do not refetch metadata');
  console.log('PASS: new agent files appear, duplicate events do not restart requests, local File and preview survive, and no upload or selection occurs.');
} finally { await act(async () => { root.unmount(); }); globalThis.fetch = originalFetch; await dom.happyDOM.close(); }
