// Run separately to isolate DOM globals from the Bun unit-test process.
import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useRoomSuggestions, defaultRoomSuggestions } = await import('../components/room/use-room-suggestions');
import type { RoomMessage } from '../lib/room-client';

const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const requests: string[] = [];
let resolveOld!: (value: Response) => void;
const originalFetch = globalThis.fetch;
Object.assign(globalThis, { fetch: async (url: string) => {
  requests.push(url);
  if (url.includes('/old/')) return new Promise<Response>((resolve) => { resolveOld = resolve; });
  if (url.includes('/failed/')) throw new Error('Offline');
  return Response.json({ suggestions: ['Review the launch plan', 'Clarify the target audience', 'Draft a release checklist'] });
} });
function Preview({ roomId, enabled = true, messages = [] }: { roomId: string; enabled?: boolean; messages?: RoomMessage[] }) {
  return createElement('p', null, useRoomSuggestions('org', roomId, 'user', enabled, messages).join('|'));
}
async function render(roomId: string, enabled = true, messages: RoomMessage[] = []) {
  await act(async () => { root.render(createElement(Preview, { roomId, enabled, messages })); });
}
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 760)); }); }
try {
  await render('not-joined', false); await settle(); assert.equal(requests.length, 0);
  await render('old'); await settle(); assert.equal(requests.length, 1);
  await render('current'); assert.equal(container.textContent, defaultRoomSuggestions.join('|'));
  await settle(); assert.match(container.textContent!, /Review the launch plan/);
  await act(async () => { resolveOld(Response.json({ suggestions: ['Old room suggestion', 'Old room next steps', 'Old room checklist'] })); });
  assert.equal(container.textContent!.includes('Old room'), false);
  await render('current'); await settle(); assert.equal(requests.length, 2);
  await render('current', true, [{ id: 'new-message', text: 'New launch plan', editedAt: null } as RoomMessage]);
  await settle(); assert.equal(requests.length, 3);
  await render('failed'); await settle(); assert.equal(container.textContent, defaultRoomSuggestions.join('|'));
  console.log('Suggestion UI checks passed: membership gating, message refresh, failure fallback, and stale-room response isolation.');
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
}
