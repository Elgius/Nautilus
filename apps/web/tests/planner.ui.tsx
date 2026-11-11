// Run separately so DOM globals do not affect the other Bun tests.
import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
import type { PlannerTask } from '../lib/planner-client';

const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Planner } = await import('../components/workspace/planner');
const originalFetch = globalThis.fetch;
let task: PlannerTask = { id: 'task', roomId: 'room', title: 'Review launch', description: '', status: 'To do', date: '', agentIds: ['current', 'removed'], revision: 1 };
const writes: Record<string, unknown>[] = [];
globalThis.fetch = (async (url, init) => {
  const path = String(url);
  if (init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body));
    writes.push(body);
    assert.deepEqual(body.agentIds, ['current'], 'removed assignments must be clearable without losing valid ones');
    task = { ...task, ...body, revision: task.revision + 1 };
    return Response.json({ task });
  }
  if (path.endsWith('/planner')) return Response.json({ rooms: [{ id: 'room', name: 'Launch', agents: [{ agent: { id: 'current', name: 'Scout' } }] }] });
  if (path.endsWith('/tasks')) return Response.json({ tasks: [task], nextCursor: null });
  if (path.endsWith('/schedules')) return Response.json({ schedules: [], nextCursor: null });
  if (path.endsWith('/tasks/task')) return Response.json({ task: { ...task, changes: [] } });
  if (path.endsWith('/work')) return Response.json({ locked: false, queued: 0, activities: [], expiresAt: null });
  throw new Error(`Unexpected request: ${path}`);
}) as typeof fetch;
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
async function button(text: string) {
  const target = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
  assert.ok(target, text);
  await act(async () => { target.click(); });
}
try {
  await act(async () => { root.render(createElement(Planner, { mode: 'Kanban', storageKey: 'tasks', organizationId: 'planner-regression' })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  await button('Review launch');
  const removed = Array.from(document.querySelectorAll('fieldset label')).find((label) => label.textContent?.includes('Removed agent (removed)'))?.querySelector('input');
  assert.ok(removed, 'stale assignments stay visible in the edit dialog');
  assert.equal(removed.checked, true);
  await act(async () => { removed.click(); });
  await button('Save task');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedRevision, 1);
  await button('Review launch');
  assert.equal(document.querySelector('fieldset')?.textContent?.includes('Removed agent'), false, 'saved removal survives reopening');
  assert.equal(document.querySelector<HTMLInputElement>('fieldset input')?.checked, true);
  console.log('Planner UI checks passed: removed assignment recovery, valid assignment retention, save, and reopen.');
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
}
