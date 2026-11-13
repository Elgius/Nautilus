// Run in isolation with Bun: exercises actual room save and agent request wiring.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, getComputedStyle: dom.getComputedStyle.bind(dom), MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act, createElement, useEffect, useEffectEvent, Fragment } = await import('react');
const { createRoot } = await import('react-dom/client');
const { officeContent } = await import('../lib/office-content');
const { initialRoomFileState } = await import('../lib/room-file-state');
const { flushRoomDocuments } = await import('../lib/room-document-save');
let visible, editorProps, chat;
function Editor(props) {
  editorProps = props;
  const { initialContent, onReady } = props;
  const suspend = useEffectEvent(props.onSuspend);
  useEffect(() => {
    visible = structuredClone(initialContent);
    onReady({ snapshot: async () => structuredClone(visible) });
    return () => { suspend(structuredClone(visible), initialContent); onReady(null); };
  }, [initialContent, onReady]);
  return createElement('div', null, 'Editor');
}
mock.module('../components/room/univer-editor', () => ({ default: Editor, preloadOfficeEditor: async () => {} }));
const { RoomDocuments } = await import('../components/room/room-documents');
const { useRoomChat } = await import('../components/room/use-room-chat');
function Chat() { const state = useRoomChat('org', 'room', 'user', true); useEffect(() => { chat = state; }); return null; }
const sockets = [];
globalThis.WebSocket = class {
  static OPEN = 1; readyState = 1; sent = [];
  constructor() { sockets.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
};
let authoritative = { content: null, currentVersionId: null }, writes = [], fail = false, gate, locked = false;
const work = () => ({ locked, queued: 0, activities: [], expiresAt: null, versions: { doc: authoritative.currentVersionId } });
globalThis.fetch = async (url, init) => {
  if (url.endsWith('/socket-ticket')) return Response.json({ url: 'ws://localhost/room' });
  if (url.endsWith('/work')) return Response.json(work());
  if (url.endsWith('/attachments')) return Response.json({ attachments: [] });
  if (url.endsWith('/content')) return Response.json(authoritative);
  if (url.endsWith('/versions') && init?.method === 'POST') {
    const input = JSON.parse(init.body); writes.push(input);
    if (gate) await gate;
    if (fail) return Response.json({ error: 'Storage unavailable' }, { status: 503 });
    assert.equal(input.expectedVersionId, authoritative.currentVersionId, 'serialized saves use the latest head');
    const id = `v${writes.length}`;
    authoritative = { content: input.content, currentVersionId: id };
    return Response.json({ version: { id, versionNumber: writes.length, createdAt: new Date().toISOString() } });
  }
  throw new Error(`Unexpected request ${url}`);
};
const container = document.createElement('div'), actions = document.createElement('div');
document.body.append(container, actions);
const root = createRoot(container);
const wait = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); }); };
const edit = async text => { await act(async () => { visible = officeContent('DOCUMENT', 'doc', 'Brief', { format: 'markdown', text }); editorProps.onDirty(); }); };
const updateWork = async value => { locked = value; await act(async () => { window.dispatchEvent(new window.CustomEvent('room-work-update', { detail: { organizationId: 'org', roomId: 'room', work: work() } })); }); };
const agent = { id: 'agent', name: 'Agent', role: '' };
try {
  await act(async () => { root.render(createElement(Fragment, null, createElement(Chat), createElement(RoomDocuments, {
    dirtyDocumentIds: new Set(), navigationContainer: null, actionsContainer: actions, organizationId: 'org', roomId: 'room',
    initialDocuments: [{ id: 'doc', title: 'Brief', kind: 'DOCUMENT', category: '', status: 'DRAFT', currentVersionId: null, updatedAt: '' }],
    storageConfigured: true, fileState: initialRoomFileState('doc'), dispatchFiles() {}, onSelect() {}, onDirtyChange() {},
  }))); });
  const socket = sockets.at(-1);
  await act(async () => { socket.onmessage({ data: JSON.stringify({ type: 'ready' }) }); socket.onmessage({ data: JSON.stringify({ type: 'sync', messages: [], nextCursor: null }) }); });
  await wait();
  assert.equal(writes.length, 1, 'new documents initialize their first version automatically');
  await edit('Autosaved text'); await wait();
  assert.equal(writes.length, 2, 'user edits save without clicking Save');
  await wait(); assert.equal(writes.length, 2, 'clean documents do not produce duplicate versions');
  let release; gate = new Promise(resolve => { release = resolve; });
  await edit('Before agent');
  let invoke;
  await act(async () => { invoke = chat.invokeAgent(agent, 'Read my document'); await Promise.resolve(); });
  assert.equal(socket.sent.filter(event => event.type === 'agent.invoke').length, 0, 'agent cannot start while storage is pending');
  // Keep editing while a save is in flight: flush must include this new revision.
  await edit('Latest before agent');
  await act(async () => { gate = null; release(); assert.equal(await invoke, true); });
  assert.equal(authoritative.content.snapshot.body.dataStream, 'Latest before agent\r\n');
  assert.equal(socket.sent.filter(event => event.type === 'agent.invoke').length, 1);
  gate = new Promise(resolve => { release = resolve; });
  await edit('Latest before reconnect replay');
  await act(async () => { socket.onmessage({ data: JSON.stringify({ type: 'sync', messages: [], nextCursor: null }) }); await Promise.resolve(); });
  assert.equal(socket.sent.filter(event => event.type === 'agent.invoke').length, 1, 'reconnect replay also waits for storage');
  await act(async () => { gate = null; release(); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(authoritative.content.snapshot.body.dataStream, 'Latest before reconnect replay\r\n');
  const invocations = socket.sent.filter(event => event.type === 'agent.invoke');
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].requestId, invocations[1].requestId, 'reconnect reuses the original request identity');
  await edit('Unsaved after failure'); fail = true;
  await act(async () => { assert.equal(await chat.invokeAgent(agent, 'Must not start'), false); });
  assert.equal(socket.sent.filter(event => event.type === 'agent.invoke').length, 2, 'save failure blocks the run');
  assert.match(chat.notice, /Storage unavailable/);
  const failedCount = writes.length; await wait(); await wait();
  assert.equal(writes.length, failedCount, 'failed autosaves do not loop or discard the draft');
  fail = false;
  await act(async () => { await flushRoomDocuments('org', 'room'); });
  await edit('Pending at lock'); await updateWork(true); await wait();
  const lockedCount = writes.length;
  await updateWork(false); await wait();
  assert.equal(writes.length, lockedCount + 1, 'pending edits save after the agent releases the room');
  assert.equal(authoritative.content.snapshot.body.dataStream, 'Pending at lock\r\n');
  console.log('PASS: initial save, autosave, no duplicate versions, pre-run save barrier, edits during saves, failure blocking/retry, and post-run saving.');
} finally { await act(async () => { root.unmount(); }); await dom.happyDOM.close(); }
