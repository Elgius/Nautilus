import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
import type { ActivityRun } from '../../../shared/agent-activity';
const dom = new Window({ url: 'http://localhost:3000/?view=Activity' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'Event'] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom) });
const { act, createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { SWRConfig } = await import('swr');
const { AgentActivity } = await import('../components/workspace/agent-activity');
const originalFetch = globalThis.fetch, requests: URL[] = [];
let owner = 'alice', fail = false;
const run: ActivityRun = { id: 'run', roomId: 'room', roomName: 'Launch', agentId: 'scout', agentName: 'Scout', title: 'Prepare launch plan', status: 'complete', source: 'manual', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:01:00Z', startedAt: '2026-11-17T00:00:01Z', finishedAt: '2026-11-17T00:01:00Z', activities: [], documentCount: 1, taskCount: 1 };
Object.assign(globalThis, { fetch: async (input: string, init?: RequestInit) => {
  const url = new URL(String(input), dom.location.origin); requests.push(url);
  if (init?.method === 'POST') return Response.json({ nextCursor: null });
  if (fail) return Response.json({}, { status: 503 });
  if (url.pathname.endsWith('/room/run')) return Response.json({ instruction: 'PRIVATE ALICE REQUEST', reply: 'Launch plan saved.', error: null, documents: [{ documentId: 'doc', versionId: 'version', versionNumber: 1, title: 'Launch plan', available: true }], tasks: [{ taskId: 'task', revision: 2, title: 'Ship launch', available: true }] });
  return Response.json({ runs: owner === 'bob' || url.searchParams.get('status') === 'failed' ? [] : url.searchParams.has('cursor') ? [{ ...run, id: 'older', title: 'Earlier request' }] : [run], active: [], rooms: [{ id: 'room', name: 'Launch' }], agents: [{ id: 'scout', name: 'Scout' }], nextCursor: !url.searchParams.has('cursor') && !url.searchParams.has('status') ? 'older-cursor' : null });
} });
const container = document.createElement('div'); document.body.append(container); const root = createRoot(container), cache = new Map();
async function render() {
  await act(async () => { root.render(h(SWRConfig, { value: { provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false } }, h(AgentActivity, { key: owner, organizationId: 'org', userId: owner }))); await new Promise((r) => setTimeout(r, 40)); });
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label)); assert.ok(button, `Missing ${label}`);
  await act(async () => { button.click(); await new Promise((r) => setTimeout(r, 30)); });
}
try {
  await render();
  assert.match(container.textContent!, /Prepare launch plan/);
  assert.doesNotMatch(container.textContent!, /PRIVATE ALICE REQUEST/);
  assert.equal(requests.some((u) => u.pathname.endsWith('/room/run')), false, 'detail fetched before expansion');
  await click('Prepare launch plan');
  assert.match(container.textContent!, /PRIVATE ALICE REQUEST/); assert.match(container.textContent!, /Launch plan saved/); assert.match(container.textContent!, /Ship launch/);
  await click('Load more activity'); assert.match(container.textContent!, /Earlier request/);
  const status = container.querySelector<HTMLSelectElement>('[aria-label="Filter by status"]')!;
  await act(async () => { status.value = 'failed'; status.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 30)); });
  assert.match(container.textContent!, /No matching requests/); assert.doesNotMatch(container.textContent!, /PRIVATE ALICE REQUEST/);
  assert.ok(requests.some((u) => u.searchParams.get('status') === 'failed' && !u.searchParams.has('cursor')));
  await click('Clear filters');
  fail = true; await click('Refresh'); assert.match(container.textContent!, /Couldn’t load your activity/);
  fail = false; await click('Retry activity'); assert.doesNotMatch(container.textContent!, /Couldn’t load your activity/);
  owner = 'bob'; await render(); assert.doesNotMatch(container.textContent!, /PRIVATE ALICE REQUEST|Prepare launch plan/); assert.match(container.textContent!, /Your agent work starts here/);
  console.log('Activity UI passed: private expansion, saved changes, pagination, filter reset, retry, and identity cache isolation.');
} finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; await dom.happyDOM.close(); }
