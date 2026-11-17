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
  base: { id: scope, enabled: true, pausedAgentIds: [], nextRefreshAt: '2026-11-12T20:00:00Z', lastCheckedAt: null }, agents: [{ id: 'a', name: 'Atlas', refreshHours: 6, nextRefreshAt: '2026-11-12T20:00:00Z' }, { id: 'b', name: 'Fin', refreshHours: 6, nextRefreshAt: '2026-11-12T20:00:00Z' }], agent: { name: 'Knowledge', refreshHours: 6 }, nextCursor: null,
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
  if (method === 'POST' && url.pathname.endsWith('/agents/a')) {
    if (body.command !== 'refresh') states.get(scope)!.base.pausedAgentIds = body.command === 'pause' ? ['a'] : [];
    return Response.json({ queued: 1 });
  }
  if (method === 'PATCH' && url.pathname.endsWith('/agents/a')) {
    states.get(scope)!.agents[0].refreshHours = body.refreshHours;
    return Response.json({ refreshHours: body.refreshHours });
  }
  if (method === 'PATCH') { states.get(scope)!.base.enabled = body.enabled; return Response.json({ base: states.get(scope)!.base }); }
  if (method === 'DELETE') { states.get(scope)!.sources = []; return Response.json({ removed: true }); }
  return Response.json(states.get(scope));
} });
const session = { user: { id: 'user', name: 'User' }, activeOrganization: { id: 'org', name: 'Org' }, memberships: [{ organizationId: 'org', role: 'owner' }] } as WorkspaceSession;
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
let renderKey = 0;
async function renderKnowledge(initialSession = session) {
  await act(async () => {
    root.render(createElement(SWRConfig, { key: ++renderKey, value: { provider: () => new Map(), dedupingInterval: 0 } }, createElement(WorkspaceSessionProvider, { initialSession, children: createElement(KnowledgeBase, { organizationId: 'org' }) })));
    await new Promise((r) => setTimeout(r, 20));
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text);
  assert.ok(button, `Missing button ${text}`);
  await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
}
try {
  await renderKnowledge();
  assert.doesNotMatch(container.textContent!, /Refresh now/);
  assert.match(container.textContent!, /PRIVATE FINDING/);
  await click('Organization');
  assert.match(container.textContent!, /TEAM FINDING/);
  assert.doesNotMatch(container.textContent!, /PRIVATE FINDING/);
  await click('Evidence and history');
  assert.match(container.textContent!, /UTF-16 0–20/);
  await click('Atlas, Active');
  assert.match(document.body.textContent!, /every 6 hours/);
  const hours = document.querySelector<HTMLInputElement>('input[type="number"]')!;
  const save = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save interval')!;
  for (const [value, valid] of [['25', false], ['0', false], ['1.5', false], ['', false], ['1', true], ['24', true]] as const) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hours, value);
      hours.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(save.disabled, !valid, 'Interval: ' + value);
  }
  await click('Save interval');
  assert.match(document.body.textContent!, /every 24 hours/);
  await click('Refresh now');
  assert.ok(requests.some((r) => r.method === 'POST' && r.path.endsWith('/agents/a') && r.body?.command === 'refresh' && r.body?.scope === 'ORGANIZATION'));
  await click('Pause agent');
  assert.ok(container.querySelector('[aria-label="Fin, Active"]'));
  assert.ok(container.querySelector('[aria-label="Atlas, Rest"]'));
  assert.equal([...document.querySelectorAll('button')].find((b) => b.textContent === 'Refresh now')!.disabled, true);
  await click('Resume agent');
  await click('Close');
  const remove = container.querySelector<HTMLButtonElement>('[aria-label="Remove ORGANIZATION source from Knowledge"]')!;
  await act(async () => { remove.click(); await new Promise((r) => setTimeout(r, 20)); });
  assert.doesNotMatch(container.textContent!, /TEAM FINDING/);
  assert.match(container.textContent!, /Good work starts with good context/);

  // Existing paused buckets remain recoverable without creating a workspace agent.
  for (const state of states.values()) { state.agents = []; state.base.enabled = false; }
  await renderKnowledge();
  assert.match(container.textContent!, /Knowledge checks are paused/);
  assert.equal([...container.querySelectorAll('button')].find(b => b.textContent === 'Refresh now')!.disabled, true);
  await click('Resume knowledge checks');
  assert.ok(requests.some(r => r.method === 'PATCH' && r.path.endsWith('/knowledge') && r.body?.scope === 'PERSONAL' && r.body.enabled === true));
  assert.match(container.textContent!, /Knowledge checks resumed/);
  assert.equal(states.get('ORGANIZATION')!.base.enabled, false);
  await click('Refresh now');
  assert.ok(requests.some(r => r.method === 'POST' && r.path.endsWith('/refresh') && r.body?.scope === 'PERSONAL'));
  assert.match(container.textContent!, /Refresh queued/);
  await click('Pause knowledge checks');
  assert.equal(states.get('PERSONAL')!.base.enabled, false);
  assert.match(container.textContent!, /Knowledge checks paused/);

  await renderKnowledge({ ...session, memberships: [{ organizationId: 'org', role: 'member' }] } as WorkspaceSession);
  assert.ok([...container.querySelectorAll('button')].some(b => b.textContent === 'Resume knowledge checks'));
  await click('Organization');
  assert.ok(![...container.querySelectorAll('button')].some(b => b.textContent === 'Resume knowledge checks'));
  await renderKnowledge();
  await click('Organization');
  await click('Resume knowledge checks');
  assert.ok(requests.some(r => r.method === 'PATCH' && r.path.endsWith('/knowledge') && r.body?.scope === 'ORGANIZATION' && r.body.enabled === true));

  await act(async () => { root.render(createElement(KnowledgeSourceTag, { organizationId: 'org', roomId: 'room', messageId: 'message' })); });
  await click('Knowledge');
  assert.match(document.body.textContent!, /Other messages and linked documents are excluded/);
  await click('Tag for Personal Knowledge');
  assert.ok(requests.some((r) => r.path.endsWith('/sources') && r.body?.messageId === 'message' && r.body.scope === 'PERSONAL' && !('documentId' in r.body)));
  console.log('Knowledge UI passed: separate buckets, schedules, agent and empty-roster controls, permissions, evidence, removal, and explicit message tagging.');
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
}
