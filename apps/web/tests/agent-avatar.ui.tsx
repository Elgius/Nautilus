// Run separately so DOM globals do not affect the other Bun tests.
import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';

const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom : dom[key as keyof Window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), getComputedStyle: dom.getComputedStyle.bind(dom) });
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { CreateAgentDialog } = await import('../components/agents/create-agent-dialog');
const { AgentProfileDialog } = await import('../components/agents/agent-profile-dialog');
const { AgentPortrait } = await import('../components/agents/agent-portrait');
const { RoomChatComposer } = await import('../components/room/room-chat-composer');
const { createAgentFromDescription, persistAgent, toAgent } = await import('../lib/agent-client');
import type { Agent } from '../lib/agent-data';

const avatarDesign = { bodyPath: 'M 10 10 L 90 10 L 50 90 Z', color: '#ffb500', eyes: [{ cx: 38, cy: 40, rx: 5, ry: 7 }, { cx: 64, cy: 40, rx: 5, ry: 7 }] };
const originalFetch = globalThis.fetch;
const bodies: Record<string, unknown>[] = [];
let stored: Record<string, unknown> | undefined;
let failCreate = true;
globalThis.fetch = (async (url, init) => {
  if (String(url).endsWith('/agent-hub-history')) return Response.json({ turns: [], next: null });
  if (String(url).endsWith('/avatar-preview')) return Response.json({ avatar: avatarDesign });
  const body = JSON.parse(String(init?.body)); bodies.push(body);
  if (String(url).endsWith('/agent_creator_agent') && failCreate) {
    failCreate = false;
    return Response.json({ error: 'Please retry creating your agent.' }, { status: 503 });
  }
  stored = { id: 'pencil', role: 'Writing', rules: ['Be concise.'], status: 'Available', avatarUrl: null, ...body };
  return Response.json({ agent: stored });
}) as typeof fetch;
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const { AgentHub } = await import('../components/agents/agent-hub');
const hub = (userId: string) => createElement(AgentHub, {
  key: userId, userId, organizationId: 'test', agents: [{ id: 'pencil', name: 'Pencil', initials: 'P', color: 'green', avatarIcon: 'circle', role: 'Writing', status: 'Available', rules: [] }],
  rooms: [], onCreate() {}, onEdit() {}, onCreateRoom() {}, onOpenRoom() {},
});
await act(async () => root.render(hub('test-user')));
const settingsTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="Agent settings and rooms"]')!;
await act(async () => settingsTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
const roomGroup = document.querySelector('[role="menu"] [role="group"]');
assert.ok(roomGroup, 'Agent settings menu opens with a group for assigned rooms');
assert.equal(document.getElementById(roomGroup.getAttribute('aria-labelledby')!)?.textContent, 'Assigned rooms');
assert.match(roomGroup.textContent ?? '', /Start a room/);
await act(async () => root.render(null));
const profileFetch = globalThis.fetch;
const prompts: string[][] = [];
let signedInUser = 'test-user';
const saved = new Map<string, Record<string, unknown>>();
const legacyId = crypto.randomUUID();
const legacyKey = 'nautilus:agent-chat:v1:test-user:test:' + legacyId;
dom.localStorage.setItem(legacyKey, JSON.stringify({ id: legacyId, agentId: 'pencil', conversationId: crypto.randomUUID(), createdAt: 1, prompt: 'Old question', reply: 'Old reply' }));
globalThis.fetch = (async (url, init) => {
  if (String(url).endsWith('/agent-hub-history')) {
    if (init?.method === 'POST') {
      const turn = JSON.parse(String(init.body));
      assert.equal(turn.userId, signedInUser);
      saved.set(turn.id, turn);
      return Response.json({ turn });
    }
    return Response.json({ turns: [...saved.values()].filter((turn) => turn.userId === signedInUser), next: null });
  }
  assert.match(String(url), /agents\/pencil\/chat$/);
  const { messages, history } = JSON.parse(String(init?.body)) as { messages: { content: string }[]; history: { id: string; conversationId: string } };
  prompts.push(messages.map((message) => message.content));
  const prompt = messages.at(-1)!.content;
  const turn = { ...history, userId: signedInUser, agentId: 'pencil', createdAt: Date.now(), prompt, reply: 'Reply to ' + prompt };
  saved.set(turn.id, turn);
  return Response.json({ text: turn.reply, turn });
}) as typeof fetch;
await act(async () => root.render(hub('test-user')));
assert.equal(dom.localStorage.getItem(legacyKey), null);
assert.match(document.querySelector('.hub-history')!.textContent!, /Old reply/);
await button('New chat');
await type('.hub-composer textarea', 'First question');
await submit('.hub-composer');
await button('New chat');
await type('.hub-composer textarea', 'Separate question');
await submit('.hub-composer');
assert.deepEqual(prompts[1], ['Separate question']);
await act(async () => root.render(null));
await act(async () => root.render(hub('test-user')));
assert.equal(document.querySelectorAll('.hub-recent-item').length, 3);
const firstChat = [...document.querySelectorAll<HTMLButtonElement>('.hub-recent-item')].find((item) => item.textContent?.includes('First question'))!;
await act(async () => firstChat.click());
assert.match(document.querySelector('.hub-history')!.textContent!, /Reply to First question/);
await type('.hub-composer textarea', 'Follow up');
await submit('.hub-composer');
assert.deepEqual(prompts[2], ['First question', 'Reply to First question', 'Follow up']);
signedInUser = 'another-user';
await act(async () => root.render(hub(signedInUser)));
assert.ok(document.querySelector('[aria-label="No conversation history"] svg'));
assert.equal(document.querySelectorAll('.hub-recent-item').length, 0);
await act(async () => root.render(null));
globalThis.fetch = profileFetch;
async function click(selector: string) {
  const button = document.querySelector(selector) as HTMLButtonElement | null;
  assert.ok(button, selector);
  await act(async () => { button.click(); });
}
async function button(text: string) {
  const target = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === text);
  assert.ok(target, text);
  await act(async () => { target.click(); });
}
async function type(selector: string, value: string) {
  const input = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  assert.ok(input, selector);
  await act(async () => {
    const prototype = input.tagName === 'TEXTAREA' ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);
  });
}
async function submit(selector = 'form') {
  await act(async () => { document.querySelector(selector)!.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event); });
}
function expectCustomAvatar() {
  assert.equal(document.querySelector('.agent-shape path')?.getAttribute('d'), avatarDesign.bodyPath);
  assert.match(document.querySelector('.agent-shape')!.getAttribute('style')!, /#ffb500/);
}
try {
  let created: Agent | undefined;
  await act(async () => { root.render(createElement(CreateAgentDialog, { organizationId: 'org', onClose() {}, onCreate: async (input) => {
    try { created = await createAgentFromDescription('org', input); return null; }
    catch (error) { return (error as Error).message; }
  } })); });
  await type('#create-agent-name', 'Pencil');
  await click('[aria-label="Generate a custom avatar"]');
  await type('#avatar-description', 'a pencil');
  await submit('.avatar-generator');
  await button('Use avatar');
  expectCustomAvatar();
  assert.equal((document.querySelector('#create-agent-name') as HTMLInputElement).value, 'Pencil');
  await button('Next');
  await type('#create-agent-work', 'Help me write.');
  await submit();
  assert.match(document.body.textContent!, /Please retry creating/);
  expectCustomAvatar();
  await submit();
  assert.ok(created);
  assert.deepEqual(bodies[0].avatarDesign, avatarDesign);
  assert.deepEqual(created.avatarDesign, avatarDesign);
  // Recreate the client model from a serialized backend response, as on reload.
  const reloaded = toAgent(JSON.parse(JSON.stringify(stored)));
  await act(async () => { root.render(createElement(AgentPortrait, { agent: reloaded })); });
  expectCustomAvatar();
  await act(async () => { root.render(createElement(RoomChatComposer, {
    canSend: true, agents: [reloaded], agentsLoading: false, agentBusy: false,
    loadAgents() {}, sendTyping() {}, sendMessage: () => true, invokeAgent: () => true,
  })); });
  await type('textarea', '@Pen');
  expectCustomAvatar();
  await click('[role="option"]');
  expectCustomAvatar();
  await act(async () => { root.render(createElement(AgentProfileDialog, { agent: reloaded, organizationId: 'org', onClose() {}, onSave: async (profile) => {
    await persistAgent('org', profile, reloaded.id); return null;
  } })); });
  await type('#agent-profile-role', 'Writing and editing');
  await submit('.agent-profile-form');
  assert.deepEqual(bodies.at(-1)!.avatarDesign, avatarDesign);
  await click('[aria-label="cloud avatar"]');
  await submit('.agent-profile-form');
  assert.equal(bodies.at(-1)!.avatarDesign, null);
  assert.equal(bodies.at(-1)!.avatarIcon, 'cloud');
  console.log('Agent avatar UI checks passed: generated selection, creation retry, reload rendering, edit preservation, and preset reset.');
} finally {
  await act(async () => { root.unmount(); });
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
}
