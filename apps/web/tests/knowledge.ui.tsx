// Run independently so DOM globals do not affect other tests.
import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
import type { WorkspaceSession } from '../lib/auth-types';
import type { KnowledgeScope, KnowledgePage } from '../lib/knowledge-client';
const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { SWRConfig } = await import('swr');
const { WorkspaceSessionProvider } = await import('../components/auth/workspace-session');
const { KnowledgeBase } = await import('../components/knowledge/knowledge-base');
const { KnowledgeSourceTag } = await import('../components/knowledge/source-tag');
const originalFetch = globalThis.fetch;
const requests: { path: string; method: string; body?: Record<string, unknown> }[] = [];
const states = new Map<KnowledgeScope, KnowledgePage>();
for (const scope of ['PERSONAL', 'ORGANIZATION'] as const) states.set(scope, {
  base: { id: scope, enabled: true, nextRefreshAt: '2026-11-12T20:00:00Z', lastCheckedAt: null }, agent: { name: 'Knowledge', refreshHours: 6 }, nextCursor: null,
  sources: [{ id: `${scope}-source`, roomId: 'room', documentId: 'document', messageId: null, title: `${scope} source`, available: true, taggedAt: '2026-11-12T14:00:00Z', canRemove: true, lastError: null, run: null,
    entry: { id: scope, title: `${scope} source`, body: scope === 'PERSONAL' ? 'PRIVATE FINDING' : 'TEAM FINDING', revision: 1, updatedAt: '2026-11-12T14:00:00Z' } }],
});
Object.assign(globalThis, { fetch: async (input: string, init?: RequestInit) => {
  const url = new URL(String(input), dom.location.origin), method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ path: url.pathname + url.search, method, body });
  const scope = (body?.scope ?? url.searchParams.get('scope')) as KnowledgeScope;
  if (method === 'GET' && url.pathname.endsWith('/history')) return Response.json({ revisions: [{ id: 'revision', revision: 1, title: 'Evidence', body: 'Saved report', createdAt: '2026-11-12T14:00:00Z', citations: [{ id: 'citation', locator: 'Document body; UTF-16 0–20', documentVersionId: 'version', messageHash: null }] }], nextCursor: null });
  if (method === 'POST' && url.pathname.endsWith('/sources')) return Response.json({ source: { id: 'tag' } }, { status: 201 });
  if (method === 'POST') return Response.json({ queued: true }, { status: 202 });
  if (method === 'PATCH') { states.get(scope)!.base.enabled = body.enabled; return Response.json({ base: states.get(scope)!.base }); }
  if (method === 'DELETE') { states.get(scope)!.sources = []; return Response.json({ removed: true }); }
  return Response.json(states.get(scope));
} });
const session = { user: { id: 'user', name: 'User' }, activeOrganization: { id: 'org', name: 'Org' }, memberships: [{ organizationId: 'org', role: 'owner' }] } as WorkspaceSession;
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === text);
  assert.ok(button, `Missing button ${text}`);
  await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
}
try {
  await act(async () => { root.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, createElement(WorkspaceSessionProvider, { initialSession: session, children: createElement(KnowledgeBase, { organizationId: 'org' }) }))); await new Promise((r) => setTimeout(r, 20)); });
  assert.match(container.textContent!, /every 6 hours/);
  assert.match(container.textContent!, /PRIVATE FINDING/);
  await click('Organization');
  assert.match(container.textContent!, /TEAM FINDING/);
  assert.doesNotMatch(container.textContent!, /PRIVATE FINDING/);
  await click('Evidence and history');
  assert.match(container.textContent!, /UTF-16 0–20/);
  await click('Refresh now');
  assert.ok(requests.some((r) => r.method === 'POST' && r.path.endsWith('/refresh') && r.body?.scope === 'ORGANIZATION'));
  await click('Pause agent');
  assert.match(container.textContent!, /Agent paused/);
  assert.equal([...container.querySelectorAll('button')].find((b) => b.textContent === 'Refresh now')!.disabled, true);
  await click('Resume agent');
  const remove = container.querySelector<HTMLButtonElement>('[aria-label="Remove ORGANIZATION source from Knowledge"]')!;
  await act(async () => { remove.click(); await new Promise((r) => setTimeout(r, 20)); });
  assert.doesNotMatch(container.textContent!, /TEAM FINDING/);
  assert.match(container.textContent!, /Good work starts with good context/);
  await act(async () => { root.render(createElement(KnowledgeSourceTag, { organizationId: 'org', roomId: 'room', messageId: 'message' })); });
  await click('Knowledge');
  assert.match(document.body.textContent!, /Other messages and linked documents are excluded/);
  await click('Tag for Personal Knowledge');
  assert.ok(requests.some((r) => r.path.endsWith('/sources') && r.body?.messageId === 'message' && r.body.scope === 'PERSONAL' && !('documentId' in r.body)));
  console.log('Knowledge UI passed: separate buckets, six-hour schedule, refresh/pause, evidence, removal, and explicit message tagging.');
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
}
