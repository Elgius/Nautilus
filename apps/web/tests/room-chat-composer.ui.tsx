// Run in its own process so DOM globals cannot affect the other Bun tests.
import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
import type { Editor } from '@tiptap/core';

const dom = new Window({ url: 'http://localhost:3000' });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'ResizeObserver', 'DOMParser', 'Text', 'DocumentFragment'] as const) {
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
const modes: string[] = [];
const agents = [{ id: 'scout', name: 'Scout', role: 'Research' }, { id: 'scribe', name: 'Scribe', role: 'Writing' }];
const props = {
  agents, agentsLoading: false, agentBusy: false, canSend: true,
  loadAgents: () => { loads++; }, sendTyping: () => { typing++; },
  sendMessage: (text: string) => { publicSends.push(text); return true; },
  invokeAgent: (agent: { id: string }, instruction: string, mode = 'write') => { modes.push(mode); privateSends.push({ agentId: agent.id, instruction }); return true; },
};
function editable() { return container.querySelector('.room-chat-editable') as HTMLDivElement & { editor: Editor }; }
function editor() { return editable().editor; }
function value() { return editor().getMarkdown(); }
async function type(value: string) {
  await act(async () => {
    editor().commands.setContent(value, { contentType: 'markdown' });
    editor().commands.setTextSelection(editor().state.doc.content.size - 1);
  });
}
async function key(key: string, options: Pick<KeyboardEventInit, 'shiftKey' | 'isComposing'> = {}) {
  let allowed = false;
  await act(async () => { allowed = editable().dispatchEvent(new dom.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }) as unknown as Event); });
  return allowed;
}
async function write(text: string) {
  await act(async () => {
    const current = editor(), { from, to } = current.state.selection;
    const handled = current.view.someProp('handleTextInput', handler => handler(current.view, from, to, text, () => current.state.tr.insertText(text, from, to)));
    if (!handled) current.view.dispatch(current.state.tr.insertText(text, from, to));
  });
}
async function click(selector: string) { await act(async () => { (container.querySelector(selector)! as HTMLButtonElement).click(); }); }
try {
  await act(async () => { root.render(createElement(RoomChatComposer, props)); });
  await click('.room-chat-suggestions button');
  assert.equal(value(), 'Summarize the discussion');
  assert.equal(document.activeElement, editable());
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
  assert.equal(value(), 'Summarize the discussion');
  await click('button[aria-label="Remove notes.txt"]');
  assert.equal(container.querySelector('[data-slot="attachment"]'), null);
  assert.equal((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false);
  await type('Hello team @');
  assert.equal(loads, 1); assert.equal(container.querySelectorAll('[role="option"]').length, 2);
  await type('Hello team @Scout summarize privately');
  await key('Enter');
  assert.equal(value(), 'summarize privately');
  assert.match(container.textContent!, /Only you/);
  await click('button[type="submit"]');
  assert.deepEqual(privateSends, [{ agentId: 'scout', instruction: 'summarize privately' }]);
  assert.equal(modes[0], 'write');
  assert.deepEqual(publicSends, []); assert.equal(typing, 0);
  await type('Another secret draft');
  await click('button[aria-label="Return to room chat"]');
  assert.equal(value(), 'Hello team');
  assert.equal(value().includes('secret'), false);
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
  assert.match(editable()!.getAttribute('aria-label')!, /Scribe/);
  await click('[aria-label="Agent request mode"] button');
  assert.match(container.textContent!, /cannot make changes/);
  await type('Only to Scribe'); await click('button[type="submit"]');
  assert.equal(privateSends.at(-1)!.agentId, 'scribe');
  assert.equal(privateSends.at(-1)!.instruction, 'Only to Scribe');
  assert.equal(modes.at(-1), 'read');
  await click('.room-chat-suggestions button');
  assert.equal(value(), 'Summarize the discussion');
  assert.equal(privateSends.length, 2); assert.equal(publicSends.length, 2);
  await click('button[aria-label="Return to room chat"]');
  assert.equal(value(), '');
  await act(async () => { root.render(createElement(RoomChatComposer, { ...props, suggestions: ['Review the launch plan', 'Clarify the target audience', 'Draft a release checklist'] })); });
  await click('.room-chat-suggestions button');
  assert.equal(value(), 'Review the launch plan');
  assert.equal(publicSends.length, 2); assert.equal(privateSends.length, 2);
  const selection = { documentId: 'doc-1', title: 'Launch plan', versionId: 'v1', location: 'body: characters 0–16', text: 'Selected passage' };
  let cleared = 0;
  const renderSelection = async (options = {}) => act(async () => { root.render(createElement(RoomChatComposer, { ...props, selection, onClearSelection: () => { cleared++; }, ...options })); });
  await renderSelection();
  assert.match(container.querySelector('blockquote')!.textContent!, /Selected passage/);
  await type('Explain this');
  editable()!.focus();
  assert.ok(container.querySelector('blockquote'), 'quote survives focus moving into chat');
  await click('button[type="submit"]');
  assert.match(publicSends.at(-1)!, /Explain this[\s\S]*Launch plan[\s\S]*> Selected passage/);
  assert.doesNotMatch(publicSends.at(-1)!, /documentId/);
  assert.equal(cleared, 1);
  await renderSelection({ sendMessage: () => false });
  await type('Keep on failure'); await click('button[type="submit"]');
  assert.equal(cleared, 1, 'failed sends retain the selection and draft');
  assert.equal(value(), 'Keep on failure');
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
  await click('button[aria-label="Return to room chat"]');
  await act(async () => { root.render(createElement(RoomChatComposer, props)); });
  const sendsBeforeLists = publicSends.length;
  for (const marker of ['-', '*', '1.', '1)']) {
    await type('');
    for (const character of `${marker} `) await write(character);
    const list = marker.startsWith('1') ? 'ol' : 'ul';
    assert.equal(editable().querySelectorAll(`${list} li`).length, 1, 'shortcut immediately renders a list inside the editor');
    await write('First item'); await key('Enter');
    assert.equal(editable().querySelectorAll(`${list} li`).length, 2, 'Enter creates the next visible item');
    await key('Enter');
    assert.equal(editable().querySelectorAll(`${list} li`).length, 1, 'Enter on an empty item exits the list');
    assert.equal(editor().isActive('listItem'), false);
    assert.equal(publicSends.length, sendsBeforeLists);
  }
  await type('9) Nine'); await key('Enter'); await write('Ten');
  assert.match(value(), /9\. Nine[\s\S]*10\. Ten/);
  await act(async () => { editor().commands.undo(); });
  assert.doesNotMatch(value(), /Ten/, 'undo edits the list');
  await type('Intro\n- First\n- Second');
  assert.equal(editable().querySelectorAll('ul li').length, 2, 'pasted or restored Markdown renders in the input');
  await type('');
  await act(async () => {
    const paste = new dom.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/plain' ? '- Pasted first\n- Pasted second' : '<img src="https://example.com/tracker">' } });
    editable().dispatchEvent(paste as unknown as Event);
  });
  assert.equal(editable().querySelectorAll('ul li').length, 2, 'clipboard Markdown becomes editable list items');
  assert.equal(editable().querySelectorAll('img').length, 0, 'clipboard HTML is ignored');
  await type('- First');
  await key('Enter', { shiftKey: true });
  assert.equal(editable().querySelectorAll('ul li').length, 1, 'Shift+Enter keeps the current item');
  assert.equal(await key('Enter', { isComposing: true }), true, 'IME confirmation is left to the browser');
  await type('x'.repeat(20000)); await write('x');
  assert.equal(value().length, 20000, 'typing respects the message limit');
  await type('- Send this list'); await click('button[type="submit"]');
  assert.match(publicSends.at(-1)!, /^- Send this list/);
  assert.equal(editor().isEmpty, true, 'successful send clears the rich editor');
  await type('Regular message'); await key('Enter');
  assert.equal(publicSends.at(-1), 'Regular message', 'ordinary Enter still sends');
  await type('@Scout'); await key('Enter');
  const typingBeforePrivateList = typing;
  await type(''); await write('-'); await write(' '); await write('Private item'); await key('Enter');
  assert.equal(editable().querySelectorAll('ul li').length, 2);
  assert.equal(typing, typingBeforePrivateList, 'private list edits do not broadcast typing');
  await key('Enter'); await click('button[type="submit"]');
  assert.match(privateSends.at(-1)!.instruction, /^- Private item/);
  console.log('Composer interaction checks passed: list shortcuts, continuation, numbering, exit, caret placement, send behavior, character limits, local attachments, suggestions, and private agent routing.');
} finally {
  await act(async () => { root.unmount(); });
  await dom.happyDOM.close();
}
