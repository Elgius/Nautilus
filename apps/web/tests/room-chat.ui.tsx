// Isolate DOM and WebSocket globals from the Bun unit-test process.
import assert from 'node:assert/strict';
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
  const state = useRoomChat('org', 'room', 'alice', true);
  useEffect(() => { chat = state; });
  return null;
}
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await act(async () => { root.render(createElement(Chat)); });
  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  const receive = (event: object) => socket.onmessage?.({ data: JSON.stringify(event) });
  const receipts = () => socket.sent.filter((event) => event.type === 'read').length;
  await act(async () => {
    receive({ type: 'ready' });
    receive({ type: 'sync', messages: [], nextCursor: null });
    for (let index = 0; index < 40; index++) receive({ type: 'message', message: {
      id: `message-${index}`, text: `Burst ${index}`, authorUserId: 'bob', createdAt: new Date().toISOString(),
    } });
  });
  assert.equal(chat!.messages.length, 40);
  assert.equal(receipts(), 1, 'a burst must not emit a receipt for every message');
  await act(async () => { chat!.sendMessage('My first message'); });
  assert.equal(socket.sent.filter((event) => event.type === 'send').length, 1);
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
