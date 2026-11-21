import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
import type { PrivateAgentJob } from '../../../shared/room-chat';
const dom = new Window({ url: 'http://localhost:3000/?view=Agents' });
for (const key of ['window', 'document', 'navigator', 'sessionStorage', 'Element', 'HTMLElement', 'HTMLButtonElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom), IntersectionObserver: dom.IntersectionObserver });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { SWRConfig } = await import('swr');
const { AgentHubChat } = await import('../components/agent-hub/agent-hub-chat');
const requests: { path: string; body?: Record<string, unknown> }[] = [];
const jobs: PrivateAgentJob[] = [];
let failSend = true;
let rejection: number | null = null;
let finishPrivateReply: ((ok: boolean) => void) | undefined;
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, init?: RequestInit) => {
  const path = String(url), body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ path, body });
  if (path.endsWith('/agent-hub-history')) return Response.json({ summaries: [], next: null });
  if (path.endsWith('/agents/agent/chat')) {
    const ok = await new Promise<boolean>((resolve) => { finishPrivateReply = resolve; });
    if (!ok) return Response.json({ error: 'The model timed out.' }, { status: 502 });
    const history = body.history;
    return Response.json({ turn: { ...history, agentId: 'agent', prompt: 'Private question', reply: 'Private answer', createdAt: Date.now() } });
  }
  if (path.endsWith('/rooms')) return Response.json({ rooms: [{ id: 'room', name: 'Design', agents: [{ agent: { id: 'agent', name: 'Scout', role: 'Research', color: 'violet', avatarIcon: 'circle' } }] }] });
  if (path.endsWith('/capabilities')) return Response.json({ documents: true, execution: true, knowledge: true, kanban: true, calendar: true, scheduling: true });
  if (path.endsWith('/history')) return Response.json({ jobs });
  if (path.endsWith('/runs')) {
    if (rejection) return Response.json({ error: 'Agent assignment expired. Choose another agent.' }, { status: rejection });
    if (failSend) { failSend = false; return Response.json({ error: 'Connection lost. Retry with the same request.' }, { status: 503 }); }
    jobs.push({ id: body.requestId, agentId: 'agent', agentName: 'Scout', instruction: body.instruction, reply: 'Launch approved. [Plan](#source-source)', status: 'complete', revision: 3,
      createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', options: body,
      tools: [{ id: 'lookup', name: 'searchKnowledge', status: 'complete', summary: 'Operation completed.' }],
      sources: [{ id: 'source', title: 'Plan', body: 'Launch approved', scope: 'ORGANIZATION', roomId: 'room', documentId: 'doc', messageId: null, updatedAt: '2026-11-17T00:00:00Z', citations: [{ quote: 'Approved for launch', locator: 'Body 0–19', documentVersionId: 'v1' }] }],
      commits: [{ documentId: 'doc', versionId: 'v2', versionNumber: 2 }], taskCommits: [{ taskId: 'task', revision: 2 }],
    });
    return Response.json({ accepted: true }, { status: 202 });
  }
  throw new Error(`Unexpected request ${path}`);
} });
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); }
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);
  assert.ok(button, `Missing button ${text}`);
  await act(async () => button.click()); await settle();
}
try {
  await act(async () => root.render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, createElement(AgentHubChat, { organizationId: 'org', userId: 'user' }))));
  await settle();
  assert.match(host.textContent!, /Agent Hub/);
  const input = host.querySelector('[aria-label="Agent Hub instruction"]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(input, 'Find our launch plan'); input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Send');
  assert.match(host.textContent!, /Connection lost/);
  await click('Retry sending instruction');
  const sends = requests.filter((request) => request.path.endsWith('/runs'));
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].body, sends[1].body, 'Uncertain retries must preserve the request ID and exact payload');
  assert.equal(sends[1].body?.reasoning, 'medium');
  assert.deepEqual(sends[1].body?.knowledge, ['ORGANIZATION']);
  assert.match(host.textContent!, /Launch approved/);
  assert.ok(host.querySelector('a[href="/room-id=room?document=doc"]'), 'Document result opens the actual document');
  assert.ok(host.querySelector('a[href="/kanban?task=task"]'), 'Task result links to Kanban');
  await click('Activity · 1 operations');
  assert.match(host.textContent!, /searchKnowledge/);
  await click('Used 1 sources');
  assert.match(host.textContent!, /Approved for launch/);
  await click('New chat');
  assert.doesNotMatch(host.textContent!, /Launch approved/);
  await click('History');
  assert.match(host.textContent!, /Launch approved/);
  await click('New chat');
  const instruction = host.querySelector('[aria-label="Agent Hub instruction"]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(instruction, 'Keep this draft after rejection'); instruction.dispatchEvent(new Event('input', { bubbles: true }));
  });
  rejection = 409;
  await click('Send');
  assert.match(host.textContent!, /Agent assignment expired/);
  assert.equal(instruction.disabled, false, 'A definitive rejection must unlock the composer');
  assert.equal(instruction.value, 'Keep this draft after rejection');
  assert.equal((host.querySelector('[aria-label="Agent Hub agent"]') as HTMLSelectElement).disabled, false, 'Users must be able to choose another agent');
  assert.equal([...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'New chat')?.disabled, false);
  assert.ok(![...host.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Retry sending instruction'), 'Terminal rejections must not trap the user in an identical retry');
  rejection = null;
  await click('Send');
  assert.equal(instruction.value, '', 'An edited or retried request can be accepted after a rejection');
  const { AgentHub } = await import('../components/agents/agent-hub');
  const noop = () => {};
  await act(async () => root.render(createElement(SWRConfig, { value: { provider: () => new Map() } }, createElement(AgentHub, {
    organizationId: 'org', userId: 'user', agents: [{ id: 'agent', name: 'Scout', initials: 'Sc', role: 'Research', color: 'violet', avatarIcon: 'circle', status: 'Available', rules: [] }], rooms: [], onCreate: noop, onEdit: noop, onCreateRoom: noop, onOpenRoom: noop,
  }))));
  await settle();
  const savedChats = host.querySelector('[aria-label="Agent hub"]');
  assert.ok(savedChats, 'The saved conversation workspace remains available');
  const savedAvatarState = () => savedChats.querySelector('.hub-identity [data-avatar-state]')?.getAttribute('data-avatar-state');
  assert.equal(savedAvatarState(), 'idle');
  await click('What can you help me with?');
  assert.equal(savedAvatarState(), 'thinking');
  await act(async () => finishPrivateReply?.(false));
  assert.equal(savedAvatarState(), 'blocked');
  assert.match(savedChats.textContent!, /The model timed out/);
  const privateForm = savedChats.querySelector<HTMLFormElement>('form')!;
  await act(async () => privateForm.requestSubmit());
  await settle();
  assert.equal(savedAvatarState(), 'thinking');
  await act(async () => finishPrivateReply?.(true));
  assert.equal(savedAvatarState(), 'done');
  assert.match(savedChats.textContent!, /Private answer/);
  await click('Room tools');
  assert.ok(host.querySelector('[aria-label="Agent Hub instruction"]'), 'Room tools expose the cited, tool-enabled conversation');
  assert.equal(savedChats.parentElement?.hidden, true);
  const roomInstruction = host.querySelector('[aria-label="Agent Hub instruction"]') as HTMLTextAreaElement;
  const roomReasoning = host.querySelector('[aria-label="Agent reasoning effort"]') as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')!.set!.call(roomInstruction, 'Keep this instruction across views');
    roomInstruction.dispatchEvent(new Event('input', { bubbles: true }));
    roomReasoning.value = 'high'; roomReasoning.dispatchEvent(new Event('change', { bubbles: true }));
  });
  failSend = true;
  await click('Send');
  const uncertainRun = requests.filter((request) => request.path.endsWith('/runs')).at(-1)!.body!;
  assert.equal(roomInstruction.disabled, true, 'Uncertain acceptance must retain the exact request');
  await click('Private conversations');
  assert.equal(host.querySelector('[aria-label="Agent hub"]'), savedChats, 'Switching views must preserve the saved conversation component');
  assert.equal(savedChats.parentElement?.hidden, false);
  assert.equal(roomInstruction.closest('[aria-label="Agent Hub chat"]')?.parentElement?.hidden, true);
  await click('Room tools');
  assert.equal(host.querySelector('[aria-label="Agent Hub instruction"]'), roomInstruction, 'Room tools must stay mounted');
  assert.equal(roomInstruction.value, 'Keep this instruction across views');
  assert.equal(roomReasoning.value, 'high');
  assert.equal(roomInstruction.disabled, true, 'Pending acceptance must survive a view switch');
  await click('Retry sending instruction');
  assert.deepEqual(requests.filter((request) => request.path.endsWith('/runs')).at(-1)!.body, uncertainRun, 'Retry must preserve the original request ID and options');
  console.log('Agent Hub UI checks passed: discovery, exact retry, configured options, tools, citations, history, terminal-error recovery, and switching between saved chats and room tools.');
} finally {
  await act(async () => root.unmount());
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
  await dom.happyDOM.close();
}
