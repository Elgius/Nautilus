import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
import type { PrivateAgentJob } from '../../../shared/room-chat';
const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'ResizeObserver'] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AgentReply } = await import('../components/room/private-agent-conversation');
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
const job: PrivateAgentJob = { id: 'run', agentId: 'agent', agentName: 'Scout', instruction: 'What is the budget?', reply: 'Budget approved [Plan](#source-plan). [Invented](#source-missing)', status: 'complete', revision: 1, createdAt: '', updatedAt: '',
  citations: [{ id: 'citation-1', number: 1, sourceId: 'plan', sourceType: 'document', title: 'Approved budget', url: '/room-id=room?document=doc', scope: 'ROOM', quote: 'Budget approved: $500', locator: 'Budget sheet; row 2, column 1', documentVersionId: 'v3' }],
};
try {
  await act(async () => root.render(createElement(AgentReply, { text: job.reply, job })));
  const badge = host.querySelector('button[aria-label="Citation 1: Approved budget"]') as HTMLButtonElement;
  assert.ok(badge, 'Render citation badges from response JSON even without raw source objects');
  assert.equal(badge.textContent, '[1]');
  assert.equal(host.querySelectorAll('button').length, 1, 'Unknown model source IDs never get citation badges');
  await act(async () => { badge.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.match(document.body.textContent!, /Budget approved: \$500/);
  assert.match(document.body.textContent!, /Budget sheet; row 2, column 1/);
  assert.match(document.body.textContent!, /Saved version: v3/);
  assert.ok(document.querySelector('a[href="/room-id=room?document=doc"]'), 'Evidence popup opens the verified source');
  await act(async () => root.render(createElement(AgentReply, { text: job.reply, job: { ...job, citations: [] } })));
  assert.equal(host.querySelectorAll('button').length, 0, 'Withdrawn citations are removed from chat');
  console.log('Inline citation checks passed: structured JSON, numbered badges, click-to-open evidence, locator/version, source links and withdrawn markers.');
} finally { await act(async () => root.unmount()); await dom.happyDOM.close(); }
