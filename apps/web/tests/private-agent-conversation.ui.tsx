import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
import type { PrivateAgentJob } from '../../../shared/room-chat';
const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, getComputedStyle: dom.getComputedStyle.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { PrivateAgentConversation } = await import('../components/room/private-agent-conversation');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const job = (id: string, status: PrivateAgentJob['status']): PrivateAgentJob => ({ id, agentId: 'agent', agentName: 'Writer', instruction: id, reply: '', status, createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z', revision: 1 });
async function render(jobs: PrivateAgentJob[]) {
  await act(async () => root.render(createElement(PrivateAgentConversation, { jobs, canSend: true, busy: false, retry: () => true })));
}
const turns = () => [...container.querySelectorAll('.room-private-instruction')].map((el) => el.textContent);
async function toggle() {
  await act(async () => (container.querySelector('.room-private-conversation-toggle') as HTMLButtonElement).click());
}
try {
  await render([job('old', 'complete')]);
  assert.equal(container.querySelector('button')?.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(turns(), []);
  await render([job('old', 'complete'), job('latest', 'queued')]);
  assert.deepEqual(turns(), ['You: latest']);
  for (const status of ['running', 'complete', 'failed'] as const) {
    await render([job('old', 'queued'), job('latest', status)]);
    assert.deepEqual(turns(), [], 'Do not show older queued messages when the latest leaves the queue');
  }
  await toggle();
  assert.deepEqual(turns(), ['You: old', 'You: latest']);
  assert.equal(container.querySelector('button')?.getAttribute('aria-expanded'), 'true');
  await render([job('old', 'complete'), job('latest', 'queued')]);
  assert.equal(turns().length, 2, 'Updates keep an expanded accordion open');
  await toggle();
  assert.deepEqual(turns(), ['You: latest']);
  await render([job('old', 'complete'), job('latest', 'complete')]);
  assert.deepEqual(turns(), []);
  await toggle();
  assert.equal(turns().length, 2, 'Completed messages remain in history');
  console.log('Agent accordion checks passed: closed default, latest queued preview, lifecycle transitions, and full history.');
} finally {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
}
