import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrivateAgentConversation } from '../components/room/private-agent-conversation';
import type { PrivateAgentJob } from '../../../shared/room-chat';

function render(reply: string, status: PrivateAgentJob['status'] = 'complete') {
  return renderToStaticMarkup(<PrivateAgentConversation canSend busy={false} retry={() => true} jobs={[{
    id: 'job', agentId: 'agent', agentName: 'Scout', instruction: '**Keep my instruction literal**', reply,
    status, revision: 1, createdAt: '', updatedAt: '',
  }]} />);
}

test('private replies render Markdown blocks and GFM while user instructions stay literal', () => {
  const html = render('## Summary\n\nThe **Launch readiness tracker** is *ready*.\n\n- First\n- Second\n\n1. Review\n2. Save\n\n> A quote\n\n`inline`\n\n```ts\nconst ready = true;\n```\n\n| Item | State |\n| --- | --- |\n| Launch | Done |\n\n[Details](https://example.com)');
  for (const tag of ['<h2>Summary</h2>', '<strong>Launch readiness tracker</strong>', '<em>ready</em>', '<ul>', '<ol>', '<blockquote>', '<pre>', '<table>', '<th>Item</th>']) assert.ok(html.includes(tag), tag);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /\*\*Keep my instruction literal\*\*/);
});

test('streaming partial Markdown updates into formatted output', () => {
  assert.doesNotThrow(() => render('The **Launch readiness', 'running'));
  assert.match(render('The **Launch readiness tracker**', 'running'), /<strong>Launch readiness tracker<\/strong>/);
});

test('untrusted replies cannot render raw HTML, executable links or remote images', () => {
  const html = render('<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n![External image](https://example.com/tracker.png)');
  assert.doesNotMatch(html, /<script|href="javascript:|<img|tracker\.png/);
  assert.match(html, /External image/);
});
