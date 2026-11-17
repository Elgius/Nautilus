import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MutationObserver', 'ResizeObserver'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { PrivateAgentConversation } = await import('../components/room/private-agent-conversation');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const job = { id: 'run', agentId: 'agent', agentName: 'Scout', instruction: 'Create a worksheet', reply: '', status: 'failed' as const,
  errorCode: 'RUN_TIMEOUT' as const, error: 'Do not render this arbitrary error text', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1,
  commits: [1, 2, 3, 4].map((versionNumber) => ({ documentId: 'doc', versionId: `v${versionNumber}`, versionNumber })),
  issues: [{ code: 'REVIEW_REJECTED' as const, stage: 'review' as const, retryable: false, reason: 'scope_mismatch' as const }],
};
try {
  await act(async () => { root.render(createElement(PrivateAgentConversation, { jobs: [job], canSend: true, busy: false, retry: () => true })); });
  assert.match(container.querySelector('[role="status"]')!.textContent!, /^The agent ran out of time\. 4 edit batches were saved\. Continue to finish the remaining sections\.$/);
  assert.doesNotMatch(container.textContent!, /arbitrary error/);
  assert.match(container.querySelector('details')!.textContent!, /exceeded the requested scope/);
  await act(async () => { root.render(createElement(PrivateAgentConversation, { jobs: [{ ...job, status: 'complete', errorCode: undefined }], canSend: true, busy: false, retry: () => true })); });
  assert.match(container.querySelector('[role="status"]')!.textContent!, /Response complete with operation warnings/);
  console.log('Agent error UI checks passed.');
} finally { await act(async () => root.unmount()); dom.happyDOM.abort(); }
