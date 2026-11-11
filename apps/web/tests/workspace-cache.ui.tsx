import assert from 'node:assert/strict';
import { GlobalWindow as Window } from 'happy-dom';
const dom = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });
const { act, createElement: h, Activity } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: useSWR } = await import('swr');
const { WorkspaceCache } = await import('../components/workspace/workspace-cache');
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
let identity = 'user-a';
function Data() {
  const { data } = useSWR('same-key', async () => identity);
  return h('p', null, data ?? 'Loading');
}
async function render(mode: 'visible' | 'hidden', scope = 'a') {
  await act(async () => {
    root.render(h(Activity, { mode, children: h(WorkspaceCache, { key: scope, children: h(Data) }) }));
  });
}
try {
  await render('visible');
  assert.equal(container.textContent, 'user-a');
  for (let i = 0; i < 3; i++) {
    await render('hidden');
    await render('visible');
    assert.equal(container.textContent, 'user-a');
  }
  identity = 'user-b';
  await render('visible', 'b');
  assert.equal(container.textContent, 'user-b');
  console.log('Workspace cache survives Activity hide/reveal and isolates identities.');
} finally {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
}

// SWR retains request-deduplication timers after unmount.
process.exit(0);
