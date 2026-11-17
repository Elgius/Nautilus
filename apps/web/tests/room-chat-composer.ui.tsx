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
let typing = 0;
const modes: string[] = [];
const agents = [{ id: 'scout', name: 'Scout', role: 'Research' }, { id: 'scribe', name: 'Scribe', role: 'Writing' }];
const props = {
  members: [{ id: 'maya', name: 'Maya' }], agents, agentsLoading: false, agentBusy: false, canSend: true,
  sendTyping: () => { typing++; },
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
  await click('button[aria-label="Personal agent"]');
  const scout = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent === 'Scout');
  assert.ok(scout);
  await act(async () => scout.click());
  await click('.room-chat-suggestions button');
  assert.equal(value(), 'Summarize the discussion');
  assert.equal(document.activeElement, editable());
  assert.equal(typing, 0); assert.deepEqual(publicSends, []);
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
  assert.equal(publicSends.length, 0); assert.equal(privateSends.length, 0); assert.equal(typing, 0);
  assert.equal(value(), 'Summarize the discussion');
  await click('button[aria-label="Remove notes.txt"]');
  assert.equal(container.querySelector('[data-slot="attachment"]'), null);
  assert.equal((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, false);
  await type('Hello agent'); await key('Enter');
  assert.deepEqual(privateSends, [{ agentId: 'scout', instruction: 'Hello agent' }]);
  assert.equal(typing, 0);
  await type('Hello @Ma'); await key('Enter');
  assert.equal(value(), 'Hello');
  assert.match(editable().getAttribute('aria-label')!, /Maya/);
  await key('Enter');
  assert.deepEqual(publicSends, ['Hello']);
  assert.match(editable().getAttribute('aria-label')!, /Scout/);
  await type('@Unknown'); await key('Escape');
  assert.equal((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled, true);
  await type('person@example.com'); await key('Enter');
  assert.equal(privateSends.at(-1)?.instruction, 'person@example.com');
  await click('[aria-label="Agent request mode"] button');
  await type('Ask privately'); await key('Enter');
  assert.equal(modes.at(-1), 'read');
  const selection = { documentId: 'doc-1', title: 'Launch plan', versionId: 'v1', location: 'body: characters 0–16', text: 'Selected passage' };
  let cleared = 0;
  const renderSelection = async (options = {}) => act(async () => { root.render(createElement(RoomChatComposer, { ...props, selection, onClearSelection: () => { cleared++; }, ...options })); });
  await renderSelection();
  assert.match(container.querySelector('blockquote')!.textContent!, /Selected passage/);
  await type('@Maya Explain this'); await key('Enter');
  editable()!.focus();
  assert.ok(container.querySelector('blockquote'), 'quote survives focus moving into chat');
  await click('button[type="submit"]');
  assert.match(publicSends.at(-1)!, /Explain this[\s\S]*Launch plan[\s\S]*> Selected passage/);
  assert.doesNotMatch(publicSends.at(-1)!, /documentId/);
  assert.equal(cleared, 1);
  await renderSelection({ sendMessage: () => false });
  await type('@Maya Keep on failure'); await key('Enter'); await click('button[type="submit"]');
  assert.equal(cleared, 1, 'failed sends retain the selection and draft');
  assert.equal(value(), 'Keep on failure');
  await click('button[aria-label="Remove selected excerpt"]');
  assert.equal(cleared, 2);
  await renderSelection();
  await click('button[aria-label="Remove recipient"]');
  await type('Explain privately');
  await click('button[type="submit"]');
  assert.match(privateSends.at(-1)!.instruction, /Explain privately[\s\S]*> Selected passage/);
  assert.match(privateSends.at(-1)!.instruction, /"documentId":"doc-1"/);
  assert.equal(cleared, 3);
  await type('x'.repeat(19990)); await click('button[type="submit"]');
  assert.match(container.querySelector('[role="alert"]')!.textContent!, /20,000/);
  assert.equal(cleared, 3, 'oversized message retains the quote');
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
  assert.match(privateSends.at(-1)!.instruction, /^- Send this list/);
  assert.equal(editor().isEmpty, true, 'successful send clears the rich editor');
  await type('Regular message'); await key('Enter');
  assert.equal(privateSends.at(-1)?.instruction, 'Regular message', 'ordinary Enter still sends');
  const typingBeforePrivateList = typing;
  await type(''); await write('-'); await write(' '); await write('Private item'); await key('Enter');
  assert.equal(editable().querySelectorAll('ul li').length, 2);
  assert.equal(typing, typingBeforePrivateList, 'private list edits do not broadcast typing');
  await key('Enter'); await click('button[type="submit"]');
  assert.match(privateSends.at(-1)!.instruction, /^- Private item/);
  await type('Keep this shared draft');
  const answers: string[] = [];
  const pendingQuestion = {
    question: { id: 'clarification', question: 'Which document?', options: ['Launch plan', 'Roadmap'] },
    agentName: 'Scout', ready: true, sending: false,
    onAnswer: (answer: string) => { answers.push(answer); },
  };
  const renderQuestion = async (sending: boolean) => {
    await act(async () => root.render(createElement(RoomChatComposer, { ...props, pendingQuestion: { ...pendingQuestion, sending } })));
  };
  const clickNamed = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
    assert.ok(button, `Expected a "${label}" button`);
    await act(async () => button.click());
  };
  const questionForm = () => container.querySelector('form[aria-label="Agent question"]') as HTMLFormElement;
  await renderQuestion(false);
  assert.ok(editable().closest('[hidden]'));
  await clickNamed('Launch plan');
  await clickNamed('Send answer');
  assert.deepEqual(answers, ['Launch plan']);
  await renderQuestion(true);
  await renderQuestion(false); // A failed save returns the unanswered question to a retryable state.
  await clickNamed('Answer later');
  assert.ok(questionForm().closest('[hidden]'));
  assert.equal(editable().closest('[hidden]'), null);
  assert.equal(value(), 'Keep this shared draft');
  await key('Enter');
  assert.equal(privateSends.at(-1)?.instruction, 'Keep this shared draft');
  await clickNamed('Answer agent question');
  assert.equal(questionForm().closest('[hidden]'), null);
  assert.equal(questionForm().querySelector('textarea')?.value, 'Launch plan');
  assert.deepEqual(answers, ['Launch plan'], 'Deferring and reopening does not submit an answer');
  console.log('Composer interaction checks passed: list shortcuts, continuation, numbering, exit, caret placement, send behavior, character limits, local attachments, suggestions, and private agent routing.');
} finally {
  await act(async () => { root.unmount(); });
  await dom.happyDOM.close();
}
