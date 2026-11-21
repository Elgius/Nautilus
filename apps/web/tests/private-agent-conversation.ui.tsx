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
const { InputBox } = await import('../components/room/input-box');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const answers: { jobId: string; answer: string }[] = [];
const job = (id: string, status: PrivateAgentJob['status']): PrivateAgentJob => ({ id, agentId: 'agent', agentName: 'Writer', instruction: id, reply: '', status, createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z', revision: 1 });
async function render(jobs: PrivateAgentJob[]) {
  await act(async () => root.render(createElement(PrivateAgentConversation, { jobs, canSend: true, busy: false, retry: () => true })));
}
const turns = () => [...container.querySelectorAll('.room-private-instruction')].map((el) => el.textContent);
const avatarState = () => container.querySelector('.room-private-turn:last-child [data-avatar-state]')?.getAttribute('data-avatar-state');
const statusText = () => container.querySelector('.room-private-turn:last-child .room-private-status')?.textContent;
async function toggle() {
  await act(async () => (container.querySelector('.room-private-conversation-toggle') as HTMLButtonElement).click());
}
try {
  await render([job('old', 'complete')]);
  assert.equal(avatarState(), 'idle', 'Loaded history does not replay completion');
  assert.equal(container.querySelector('button')?.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(turns(), ['You:old']);
  await render([job('old', 'complete'), job('latest', 'queued')]);
  assert.deepEqual(turns(), ['You:latest']);
  assert.equal(avatarState(), 'waiting');
  assert.equal(statusText(), 'Queued');
  await render([job('latest', 'running')]);
  assert.equal(avatarState(), 'thinking');
  await render([{ ...job('latest', 'running'), tools: [{ id: 'read', name: 'readDocument', status: 'running' }] }]);
  assert.equal(avatarState(), 'working');
  assert.equal(statusText(), 'Using tools');
  await render([{ ...job('latest', 'running'), activities: [{ runId: 'latest', agentId: 'agent', agentName: 'Writer', phase: 'applying' }] }]);
  assert.equal(avatarState(), 'working');
  assert.equal(statusText(), 'Applying changes');
  await render([{ ...job('latest', 'running'), confirmations: [{ id: 'confirm', label: 'Apply edits?', status: 'pending' }] }]);
  assert.equal(avatarState(), 'waiting');
  assert.equal(statusText(), 'Awaiting approval');
  for (const status of ['running', 'complete', 'failed'] as const) {
    await render([job('old', 'queued'), { ...job('latest', status), reply: 'Latest agent reply' }]);
    assert.deepEqual(turns(), ['You:latest'], 'The latest message remains visible throughout its lifecycle');
    assert.equal(container.querySelector('.room-private-reply')?.textContent, 'Latest agent reply');
    assert.equal(avatarState(), { running: 'working', complete: 'done', failed: 'blocked' }[status]);
  }
  await render([{ ...job('latest', 'failed'), errorCode: 'RUN_CANCELLED' }]);
  assert.equal(avatarState(), 'idle');
  assert.equal(statusText(), 'Cancelled.');
  await render([job('old', 'queued'), job('latest', 'failed')]);
  await toggle();
  assert.deepEqual(turns(), ['You:old', 'You:latest']);
  assert.equal(container.querySelector('button')?.getAttribute('aria-expanded'), 'true');
  await render([job('old', 'complete'), job('latest', 'queued')]);
  assert.equal(turns().length, 2, 'Updates keep an expanded accordion open');
  await toggle();
  assert.deepEqual(turns(), ['You:latest']);
  await render([job('old', 'complete'), job('latest', 'complete')]);
  assert.deepEqual(turns(), ['You:latest']);
  await toggle();
  assert.equal(turns().length, 2, 'Completed messages remain in history');
  const questionJob = { ...job('question', 'complete'), question: { id: 'question-id', question: 'Which document should I use?', options: ['test', 'tutorial write up'] } };
  await render([questionJob]);
  assert.equal(avatarState(), 'waiting');
  assert.equal(statusText(), 'Waiting for your answer');
  assert.equal(container.querySelector('textarea'), null, 'Conversation history never renders a second answer composer');
  assert.match(container.textContent!, /Which document should I use/);
  await act(async () => root.render(createElement(InputBox, { question: questionJob.question, onAnswer: (answer) => { answers.push({ jobId: questionJob.id, answer }); } })));
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  assert.equal(submit.disabled, true, 'Empty answers cannot be sent');
  const suggestion = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'test')!;
  await act(async () => suggestion.click());
  assert.equal(container.querySelector<HTMLTextAreaElement>('textarea')!.value, 'test');
  await act(async () => container.querySelector('form')!.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event));
  assert.deepEqual(answers, [{ jobId: 'question', answer: 'test' }]);
  await render([questionJob, job('newer', 'complete')]);
  assert.equal(container.querySelector('textarea'), null);
  assert.match(container.textContent!, /Which document should I use/, 'Pending questions remain visible as read-only history');
  await render([{ ...questionJob, question: { ...questionJob.question, answer: 'test' } }]);
  assert.equal(avatarState(), 'idle');
  assert.equal(container.querySelector('textarea'), null, 'Answered questions display the saved answer');
  assert.match(container.textContent!, /Your answer/);
  console.log('Agent accordion checks passed: closed default, latest message preview, replies, lifecycle transitions, and full history.');
} finally {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
}
