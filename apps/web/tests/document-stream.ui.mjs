// Run separately with Bun so DOM globals and the editor mock stay isolated.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, getComputedStyle: dom.getComputedStyle.bind(dom), MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
let animationTime = 0, frameId = 0;
const frames = new Map();
globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
function advance(milliseconds) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
    animationTime += 16;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(animationTime);
  }
}
const { act, createElement, useEffect, Fragment } = await import('react');
const { createRoot } = await import('react-dom/client');
const { officeContent } = await import('../lib/office-content');
const { initialRoomFileState } = await import('../lib/room-file-state');
let mounts = 0, dirty, visible;
const updates = [], dirtyStates = [];
function Editor({ initialContent, onReady, onDirty }) {
  dirty = onDirty;
  useEffect(() => {
    mounts++;
    visible = initialContent;
    onReady({ snapshot: async () => visible, updateContent: (content, preview = false) => { visible = content; updates.push({ content, preview }); return true; } });
    return () => onReady(null);
  }, [initialContent, onReady]);
  return createElement('div', { 'aria-label': 'Test editor' });
}
mock.module('../components/room/univer-editor', () => ({ default: Editor, preloadOfficeEditor: async () => {} }));
const { RoomDocuments } = await import('../components/room/room-documents');
const { useRoomChat } = await import('../components/room/use-room-chat');
const sockets = [];
globalThis.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  constructor() { sockets.push(this); }
  send() {}
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
};
function Chat() { useRoomChat('org', 'room', 'alice', true); return null; }
const saved = (text, version) => ({ content: officeContent('DOCUMENT', 'doc', 'Live test', { format: 'markdown', text }), currentVersionId: version });
let authoritative = saved('Hello world', 'v1');
globalThis.fetch = async (url) => {
  if (url.endsWith('/socket-ticket')) return Response.json({ url: 'ws://localhost/room' });
  if (url.endsWith('/content')) return Response.json(authoritative);
  if (url.endsWith('/versions')) return Response.json({ versions: [], nextCursor: null });
  if (url.endsWith('/attachments')) return Response.json({ attachments: [] });
  if (url.endsWith('/work')) return Response.json({ locked: true, queued: 0, activities: [], expiresAt: null, versions: { doc: authoritative.currentVersionId } });
  throw new Error(`Unexpected request: ${url}`);
};
const container = document.createElement('div'), actions = document.createElement('div');
document.body.append(container, actions);
const root = createRoot(container);
const emit = (detail) => {
  if (detail.roomId) window.dispatchEvent(new window.CustomEvent('room-document-preview', { detail: { organizationId: 'org', runId: 'run', toolCallId: 'write', ...detail } }));
  else sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'agent.document-preview', runId: 'run', toolCallId: 'write', ...detail }) });
};
const input = (version, text) => JSON.stringify({ documentId: 'doc', expectedVersionId: version, edits: [{ type: 'formatText', start: 0, end: 5, style: { bl: 1 } }, { type: 'replaceText', start: 6, end: 11, expectedText: 'world', text }] });
try {
  await act(async () => { root.render(createElement(Fragment, null, createElement(Chat), createElement(RoomDocuments, {
    dirtyDocumentIds: new Set(), navigationContainer: null, actionsContainer: actions, organizationId: 'org', roomId: 'room',
    initialDocuments: [{ id: 'doc', title: 'Live test', kind: 'DOCUMENT', category: '', status: 'DRAFT', currentVersionId: 'v1', updatedAt: '' }],
    storageConfigured: true, fileState: initialRoomFileState('doc'), dispatchFiles() {}, onSelect() {}, onDirtyChange: (_, value) => dirtyStates.push(value),
  }))); });
  assert.equal(mounts, 1);
  await act(async () => { emit({ roomId: 'another-room', input: input('v1', 'ocean') }); });
  assert.equal(updates.length, 0, 'ignore events from another room');
  await act(async () => { emit({ input: input('v1', 'oce') }); });
  assert.equal(visible.snapshot.body.dataStream, 'Hello world\r\n', 'network events queue text without revealing it all at once');
  await act(async () => advance(16));
  assert.equal(visible.snapshot.body.dataStream, 'Hello o\r\n');
  await act(async () => advance(64));
  assert.equal(visible.snapshot.body.dataStream, 'Hello oce\r\n');
  assert.match(actions.textContent, /Agent writing/);
  await act(async () => { emit({ input: input('v1', 'ocean') }); });
  assert.equal(visible.snapshot.body.dataStream, 'Hello oce\r\n');
  assert.equal(mounts, 1, 'streaming must retain the mounted editor');
  assert.ok(!dirtyStates.includes(true), 'remote text must not become a human draft');
  authoritative = saved('Hello ocean', 'v2');
  await act(async () => { emit({ input: null }); });
  assert.equal(visible.snapshot.body.dataStream, 'Hello oce\r\n', 'the saved version must wait for the remaining typing');
  assert.match(actions.textContent, /draft preview/);
  await act(async () => advance(100));
  assert.equal(visible.snapshot.body.dataStream, 'Hello ocean\r\n');
  assert.equal(updates.at(-1).preview, false);
  assert.equal(mounts, 1, 'final saved content must update in place');
  assert.doesNotMatch(actions.textContent, /draft preview/);
  // A rejected edit returns to the same saved version, even without a version change.
  await act(async () => { emit({ input: JSON.stringify({ documentId: 'doc', expectedVersionId: 'v2', edits: [{ type: 'insertText', index: 0, text: 'Unreviewed ' }] }) }); });
  await act(async () => advance(200));
  assert.match(visible.snapshot.body.dataStream, /^Unreviewed/);
  await act(async () => { emit({ input: null }); });
  assert.equal(visible.snapshot.body.dataStream, 'Hello ocean\r\n');
  // Even one full backend chunk followed immediately by its saved result must
  // type progressively, rather than flash the complete saved snapshot.
  const burst = 'A buffered backend response. '.repeat(8);
  await act(async () => {
    emit({ input: JSON.stringify({ documentId: 'doc', expectedVersionId: 'v2', edits: [{ type: 'insertText', index: 0, text: burst }] }) });
    authoritative = saved(burst + 'Hello ocean', 'v3');
    emit({ input: null });
  });
  assert.equal(visible.snapshot.body.dataStream, 'Hello ocean\r\n');
  await act(async () => advance(16));
  assert.equal(visible.snapshot.body.dataStream, 'AHello ocean\r\n');
  assert.match(actions.textContent, /draft preview/);
  await act(async () => advance(5000));
  assert.equal(visible.snapshot.body.dataStream, burst + 'Hello ocean\r\n');
  assert.doesNotMatch(actions.textContent, /draft preview/);
  // A reconnect can miss every preview: the saved response from work polling
  // must still type into the document instead of replacing it in one jump.
  authoritative = saved(burst + 'Hello ocean Recovered text.', 'v4');
  await act(async () => window.dispatchEvent(new window.CustomEvent('room-work-update', { detail: { organizationId: 'org', roomId: 'room', work: { locked: false, queued: 0, activities: [], expiresAt: null, versions: { doc: 'v4' } } } })));
  assert.equal(visible.snapshot.body.dataStream, burst + 'Hello ocean\r\n');
  await act(async () => advance(16));
  assert.equal(visible.snapshot.body.dataStream, burst + 'Hello ocean \r\n');
  await act(async () => advance(1000));
  assert.equal(visible.snapshot.body.dataStream, burst + 'Hello ocean Recovered text.\r\n');
  // Dirty local drafts are never replaced by previews or remote saved versions.
  await act(async () => { dirty(); });
  const before = updates.length;
  await act(async () => {
    emit({ input: JSON.stringify({ documentId: 'doc', expectedVersionId: 'v4', edits: [{ type: 'insertText', index: 0, text: 'Bad ' }] }) });
    window.dispatchEvent(new window.CustomEvent('room-work-update', { detail: { organizationId: 'org', roomId: 'room', work: { locked: false, queued: 0, activities: [], expiresAt: null, versions: { doc: 'v5' } } } }));
  });
  assert.equal(updates.length, before);
  assert.match(container.textContent, /unsaved draft is preserved/i);
  assert.equal(mounts, 1);
  console.log('PASS: socket → formatted progressive previews → editor, room isolation, no remount or dirty side effects, reviewed save, rejection rollback, local draft protection.');
} finally { await act(async () => root.unmount()); mock.restore(); await dom.happyDOM.close(); }
