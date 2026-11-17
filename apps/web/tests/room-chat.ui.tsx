// Isolate DOM and WebSocket globals from the Bun unit-test process.
import assert from 'node:assert/strict';
import type { RoomDocumentSaveRequest } from '../lib/room-document-save';
import { GlobalWindow as Window } from 'happy-dom';

const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
class Socket {
  static OPEN = 1;
  readyState = Socket.OPEN;
  sent: { type: string }[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}
const sockets: Socket[] = [];
Object.assign(globalThis, {
  WebSocket: class extends Socket { constructor() { super(); sockets.push(this); } },
  fetch: async () => Response.json({ url: 'ws://localhost/room' }),
});
const { act, createElement, useEffect } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useRoomChat } = await import('../components/room/use-room-chat');
let chat: ReturnType<typeof useRoomChat>;
function Chat() {
  const state = useRoomChat('org', 'room', 'alice', true, {
    messages: [{ id: 'bootstrap', text: 'Already visible', createdAt: '2026-01-01T00:00:00.000Z', editedAt: null, authorUserId: 'bob', authorUser: { name: 'Bob' }, authorAgent: null, documents: [] }],
    nextCursor: 'older-bootstrap',
  });
  useEffect(() => { chat = state; });
  return null;
}
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await act(async () => { root.render(createElement(Chat)); });
  assert.equal(chat!.messages[0].text, 'Already visible', 'bootstrap chat is visible before socket readiness');
  assert.equal(chat!.nextCursor, 'older-bootstrap');
  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  const receive = (event: object) => socket.onmessage?.({ data: JSON.stringify(event) });
  const previews: unknown[] = [];
  window.addEventListener('room-document-preview', (event) => { if ('detail' in event) previews.push(event.detail); });
  await act(async () => {
    receive({ type: 'agent.document-preview', runId: 'run', toolCallId: 'write', input: '{"partial":"text' });
  });
  assert.deepEqual(previews[0], { organizationId: 'org', roomId: 'room', type: 'agent.document-preview', runId: 'run', toolCallId: 'write', input: '{"partial":"text' });
  const receipts = () => socket.sent.filter((event) => event.type === 'read').length;
  await act(async () => {
    receive({ type: 'ready' });
    receive({ type: 'sync', messages: [], nextCursor: null });
    for (let index = 0; index < 40; index++) receive({ type: 'message', message: {
      id: `message-${index}`, text: `Burst ${index}`, authorUserId: 'bob', createdAt: new Date().toISOString(),
    } });
  });
  assert.equal(chat!.messages.length, 41);
  assert.deepEqual(socket.sent.find((event) => event.type === 'sync'), { type: 'sync', requestId: 'sync', cursor: 'bootstrap' });
  assert.equal(chat!.nextCursor, 'older-bootstrap', 'catch-up sync preserves older bootstrap pagination');
  assert.equal(receipts(), 1, 'a burst must not emit a receipt for every message');
  await act(async () => { chat!.sendMessage('My first message'); });
  assert.equal(socket.sent.filter((event) => event.type === 'send').length, 1);
  let saves = 0;
  const blockSave = (event: Event) => {
    saves++;
    (event as CustomEvent<RoomDocumentSaveRequest>).detail.waitUntil(Promise.reject(new Error('Unsaved editor is blocked')));
  };
  window.addEventListener('room-document-save', blockSave);
  const agent = { id: 'scout', name: 'Scout', role: 'Research' };
  await act(async () => { receive({ type: 'agent.history', jobs: [] }); });
  assert.equal(socket.sent.filter((event) => event.type === 'agent.list').length, 0, 'Empty history keeps profile loading lazy');
  const historicalJob = { id: 'historical', agentId: agent.id, agentName: agent.name, instruction: 'Earlier question', reply: 'Earlier reply', status: 'complete', revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  await act(async () => { receive({ type: 'agent.history', jobs: [historicalJob] }); });
  assert.equal(socket.sent.filter((event) => event.type === 'agent.list').length, 1, 'Restored conversations load profiles without opening the picker');
  assert.equal(chat!.agentsLoading, true);
  const appearance = { ...agent, color: 'teal', avatarIcon: 'cloud' };
  await act(async () => { receive({ type: 'agent.list', agents: [appearance] }); });
  assert.deepEqual(chat!.agents[0], appearance);
  assert.equal(chat!.agentsLoading, false);
  await act(async () => { receive({ type: 'agent.update', job: historicalJob }); });
  assert.equal(socket.sent.filter((event) => event.type === 'agent.list').length, 1, 'Job updates reuse the requested profiles');
  await act(async () => { assert.equal(await chat!.invokeAgent(agent, 'Save a change'), false); });
  assert.equal(saves, 1);
  await act(async () => { assert.equal(await chat!.invokeAgent(agent, 'Read saved text', 'read'), true); });
  assert.equal(saves, 1, 'Ask must not flush or save dirty editors');
  const invocation = socket.sent.find((event) => event.type === 'agent.invoke') as unknown as { requestId: string; mode: string };
  assert.equal(invocation.mode, 'read');
  const answer = { id: invocation.requestId, agentId: agent.id, agentName: agent.name, instruction: 'Read saved text', reply: 'Answer', status: 'running', revision: 1, mode: 'read', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await act(async () => { receive({ type: 'agent.update', job: answer }); });
  await act(async () => { receive({ type: 'agent.update', job: { ...answer, status: 'complete', revision: 2 } }); });
  const observations = socket.sent.filter((event) => event.type === 'agent.observed');
  assert.equal(observations.length, 1, 'First output timing is sent once per request');
  assert.equal(JSON.stringify(observations).includes('Answer'), false, 'Timings never include reply contents');
  window.removeEventListener('room-document-save', blockSave);
  await act(async () => { await pause(1100); });
  assert.equal(receipts(), 2, 'send the final receipt even when no more messages arrive');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  await act(async () => { receive({ type: 'message', message: { id: 'hidden', authorUserId: 'bob', createdAt: new Date().toISOString() } }); });
  await act(async () => { await pause(1100); });
  assert.equal(receipts(), 2, 'hidden tabs must not mark new messages read');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => { document.dispatchEvent(new dom.Event('visibilitychange') as unknown as Event); });
  assert.equal(receipts(), 3);
  await act(async () => {
    receive({ type: 'message', message: { id: 'before-unmount', authorUserId: 'bob', createdAt: new Date().toISOString() } });
  });
  await act(async () => { root.unmount(); });
  await pause(1100);
  assert.equal(receipts(), 3, 'unmounting cancels the pending receipt');
  console.log('Room chat receipt checks passed: burst coalescing, trailing delivery, hidden tabs, sends, and cleanup.');
} finally {
  await act(async () => { root.unmount(); });
  await dom.happyDOM.close();
}
