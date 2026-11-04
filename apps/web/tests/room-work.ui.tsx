import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement, useEffect } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useRoomWork } = await import('../components/room/use-room-work');
let resolveFetch!: (response: Response) => void;
Object.assign(globalThis, { fetch: () => new Promise<Response>((resolve) => { resolveFetch = resolve; }) });
let work: ReturnType<typeof useRoomWork>;
function Viewer() {
  const state = useRoomWork('org', 'room');
  useEffect(() => { work = state; });
  return createElement('p', null, state.readOnly ? 'Read-only' : 'Editable');
}
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const update = (roomId: string, locked: boolean) => window.dispatchEvent(new window.CustomEvent('room-work-update', {
  detail: { organizationId: 'org', roomId, work: { locked, queued: 0, activities: [], expiresAt: null } },
}));
try {
  await act(async () => { root.render(createElement(Viewer)); });
  assert.equal(work!.readOnly, true, 'unknown activity must fail closed');
  await act(async () => { update('different-room', false); });
  assert.equal(work!.readOnly, true, 'other room events must be ignored');
  await act(async () => { update('room', true); });
  assert.equal(work!.available, true);
  await act(async () => { resolveFetch(Response.json({ locked: false, queued: 0, activities: [], expiresAt: null })); });
  assert.equal(work!.readOnly, true, 'an older HTTP response must not override a newer socket lock');
  await act(async () => { update('room', false); });
  assert.equal(work!.readOnly, false, 'confirmed completion restores editing');
  await act(async () => { root.unmount(); });
  console.log('Room work UI checks passed: initial safety, room isolation, event ordering, completion, cleanup.');
} finally { await act(async () => { root.unmount(); }); await dom.happyDOM.close(); }
