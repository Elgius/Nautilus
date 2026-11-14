// Run in its own process so DOM globals cannot affect the other Bun tests.
import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';

const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { RoomChatComposer } = await import('../components/room/room-chat-composer');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const publicSends: string[] = [], privateSends: { agentId: string; instruction: string }[] = [];
let loads = 0, typing = 0;
const agents = [{ id: 'scout', name: 'Scout', role: 'Research' }, { id: 'scribe', name: 'Scribe', role: 'Writing' }];
const props = {
  agents, agentsLoading: false, agentBusy: false, canSend: true,
  loadAgents: () => { loads++; }, sendTyping: () => { typing++; },
  sendMessage: (text: string) => { publicSends.push(text); return true; },
  invokeAgent: (agent: { id: string }, instruction: string) => { privateSends.push({ agentId: agent.id, instruction }); return true; },
};
async function type(value: string) {
  await act(async () => {
    const textarea = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);
  });
}
async function key(key: string) {
  await act(async () => { container.querySelector('textarea')!.dispatchEvent(new dom.KeyboardEvent('keydown', { key, bubbles: true }) as unknown as Event); });
}
async function click(selector: string) { await act(async () => { (container.querySelector(selector)! as HTMLButtonElement).click(); }); }
try {
  await act(async () => { root.render(createElement(RoomChatComposer, props)); });
  await click('.room-chat-suggestions button');
  assert.equal(container.querySelector('textarea')!.value, 'Summarize the discussion');
  assert.equal(document.activeElement, container.querySelector('textarea'));
  assert.equal(typing, 0); assert.deepEqual(publicSends, []); assert.equal(loads, 0);
  const localFile = new dom.File(['Local preview'], 'notes.txt', { type: 'text/plain' });
  await act(async () => {
    const input = container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [localFile] });
    input.dispatchEvent(new dom.Event('change', { bubbles: true }) as unknown as Event);
  });
  assert.match(container.textContent!, /notes.txt/);
  assert.match(container.textContent!, /Local only/);
  assert.equal((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, true);
  await act(async () => { container.querySelector('form')!.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event); });
  assert.equal(publicSends.length, 0); assert.equal(privateSends.length, 0); assert.equal(typing, 0); assert.equal(loads, 0);
  assert.equal(container.querySelector('textarea')!.value, 'Summarize the discussion');
  await click('button[aria-label="Remove notes.txt"]');
  assert.equal(container.querySelector('[data-slot="attachment"]'), null);
  assert.equal((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false);
  await type('Hello team @');
  assert.equal(loads, 1); assert.equal(container.querySelectorAll('[role="option"]').length, 2);
  await type('Hello team @Scout summarize privately');
  await key('Enter');
  assert.equal(container.querySelector('textarea')!.value, 'summarize privately');
  assert.match(container.textContent!, /Only you/);
  await click('button[type="submit"]');
  assert.deepEqual(privateSends, [{ agentId: 'scout', instruction: 'summarize privately' }]);
  assert.deepEqual(publicSends, []); assert.equal(typing, 0);
  await type('Another secret draft');
  await click('button[aria-label="Return to room chat"]');
  assert.equal(container.querySelector('textarea')!.value, 'Hello team');
  assert.equal(container.querySelector('textarea')!.value.includes('secret'), false);
  await click('button[type="submit"]');
  assert.deepEqual(publicSends, ['Hello team']);
  await type('person@example.com'); await click('button[type="submit"]');
  assert.equal(publicSends.at(-1), 'person@example.com');
  await type('@Unknown hidden instruction');
  await key('Escape');
  assert.equal((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, true);
  await act(async () => { container.querySelector('form')!.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event); });
  assert.equal(publicSends.length, 2);
  await type('@'); await key('ArrowDown'); await key('Enter');
  assert.match(container.querySelector('textarea')!.getAttribute('aria-label')!, /Scribe/);
  await type('Only to Scribe'); await click('button[type="submit"]');
  assert.equal(privateSends.at(-1)!.agentId, 'scribe');
  assert.equal(privateSends.at(-1)!.instruction, 'Only to Scribe');
  await click('.room-chat-suggestions button');
  assert.equal(container.querySelector('textarea')!.value, 'Summarize the discussion');
  assert.equal(privateSends.length, 2); assert.equal(publicSends.length, 2);
  await click('button[aria-label="Return to room chat"]');
  assert.equal(container.querySelector('textarea')!.value, '');
  await act(async () => { root.render(createElement(RoomChatComposer, { ...props, suggestions: ['Review the launch plan', 'Clarify the target audience', 'Draft a release checklist'] })); });
  await click('.room-chat-suggestions button');
  assert.equal(container.querySelector('textarea')!.value, 'Review the launch plan');
  assert.equal(publicSends.length, 2); assert.equal(privateSends.length, 2);
  const selection = { documentId: 'doc-1', title: 'Launch plan', versionId: 'v1', location: 'body: characters 0–16', text: 'Selected passage' };
  let cleared = 0;
  const renderSelection = async (options = {}) => act(async () => { root.render(createElement(RoomChatComposer, { ...props, selection, onClearSelection: () => { cleared++; }, ...options })); });
  await renderSelection();
  assert.match(container.querySelector('blockquote')!.textContent!, /Selected passage/);
  await type('Explain this');
  container.querySelector('textarea')!.focus();
  assert.ok(container.querySelector('blockquote'), 'quote survives focus moving into chat');
  await click('button[type="submit"]');
  assert.match(publicSends.at(-1)!, /Explain this[\s\S]*Launch plan[\s\S]*> Selected passage/);
  assert.doesNotMatch(publicSends.at(-1)!, /documentId/);
  assert.equal(cleared, 1);
  await renderSelection({ sendMessage: () => false });
  await type('Keep on failure'); await click('button[type="submit"]');
  assert.equal(cleared, 1, 'failed sends retain the selection and draft');
  assert.equal(container.querySelector('textarea')!.value, 'Keep on failure');
  await click('button[aria-label="Remove selected excerpt"]');
  assert.equal(cleared, 2);
  await renderSelection();
  await type('@Scout Explain privately'); await key('Enter');
  await click('button[type="submit"]');
  assert.match(privateSends.at(-1)!.instruction, /Explain privately[\s\S]*> Selected passage/);
  assert.match(privateSends.at(-1)!.instruction, /"documentId":"doc-1"/);
  assert.equal(cleared, 3);
  await type('x'.repeat(19990)); await click('button[type="submit"]');
  assert.match(container.querySelector('[role="alert"]')!.textContent!, /20,000/);
  assert.equal(cleared, 3, 'oversized message retains the quote');
  console.log('Composer interaction checks passed: local suggestions and attachments, blocked attachment sends, @ loading, keyboard selection, private routing, private typing, preserved room draft, and unresolved-mention protection.');
} finally {
  await act(async () => { root.unmount(); });
  await dom.happyDOM.close();
}
