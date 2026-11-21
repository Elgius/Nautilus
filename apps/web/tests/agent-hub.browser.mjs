// Real Chromium UI coverage with a deterministic Hub API boundary.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const { buildSync } = createRequire(new URL('../../server/package.json', import.meta.url))('esbuild');
const output = mkdtempSync(join(tmpdir(), 'nautilus-hub-browser-'));
buildSync({ stdin: { contents: `import { createRoot } from 'react-dom/client'; import { AgentHubChat } from './components/agent-hub/agent-hub-chat'; createRoot(document.getElementById('app')).render(<AgentHubChat organizationId="org" userId="alice" />);`, resolveDir: webRoot, loader: 'tsx' }, bundle: true, outfile: join(output, 'bundle.js'), format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent', jsx: 'automatic', define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } });
const chunks = join(webRoot, '.next/static/chunks');
const css = readdirSync(chunks).filter((file) => file.endsWith('.css')).map((file) => readFileSync(join(chunks, file), 'utf8')).join('\n');
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/styles.css') return new Response(css + readFileSync(join(output, 'bundle.css'), 'utf8'), { headers: { 'Content-Type': 'text/css' } });
  if (path === '/bundle.js') return new Response(readFileSync(join(output, 'bundle.js')), { headers: { 'Content-Type': 'text/javascript' } });
  return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body style="margin:0;padding:16px;background:var(--background);color:var(--foreground);font-family:system-ui"><main id="app" style="max-width:1000px;margin:auto"></main><script src="/bundle.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } });
} });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  let jobs = [];
  await page.route('**/api/organizations/org/agent-hub/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path.endsWith('/rooms')) json = { rooms: [{ id: 'room', name: 'Product', agents: [{ agent: { id: 'agent', name: 'Scout', role: 'Research', color: 'violet', avatarIcon: 'circle' } }] }] };
    else if (path.endsWith('/capabilities')) json = { execution: true, documents: true, knowledge: true, kanban: true, calendar: true, scheduling: true };
    else if (path.endsWith('/history')) json = { jobs };
    else if (path.endsWith('/runs')) {
      const body = route.request().postDataJSON();
      jobs = [{ id: body.requestId, agentId: 'agent', agentName: 'Scout', instruction: body.instruction, reply: 'The [launch plan](#source-source) is approved. Please confirm deletion of the old task.', status: 'running', revision: 1, options: body,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        citations: [{ id: 'citation-1', number: 1, sourceId: 'source', sourceType: 'knowledge', scope: 'ORGANIZATION', title: 'Launch plan', url: '/room-id=room?document=doc', quote: 'Launch approved by the team.', locator: 'Document body', documentVersionId: 'v1' }],
        tools: [{ id: 'search', name: 'searchKnowledge', status: 'complete' }, { id: 'delete', name: 'deleteTask', status: 'running' }],
        sources: [{ id: 'source', title: 'Launch plan', body: 'Launch approved.', scope: 'ORGANIZATION', roomId: 'room', documentId: 'doc', messageId: null, updatedAt: new Date().toISOString(), citations: [{ quote: 'Launch approved by the team.', locator: 'Document body', documentVersionId: 'v1' }] }],
        confirmations: [{ id: 'confirmation', label: 'Delete the old launch task from Kanban and Calendar?', status: 'pending' }], commits: [{ documentId: 'doc', versionId: 'v2', versionNumber: 2 }],
      }]; json = { accepted: true };
    } else if (path.endsWith('/confirm')) {
      assert.equal(route.request().postDataJSON().approved, true);
      jobs[0] = { ...jobs[0], status: 'complete', revision: 2, confirmations: [{ ...jobs[0].confirmations[0], status: 'approved' }], tools: jobs[0].tools.map((call) => ({ ...call, status: 'complete' })), taskCommits: [{ taskId: 'task', revision: 2 }] };
      json = { accepted: true };
    } else throw new Error(`Unexpected path ${path}`);
    await route.fulfill({ json });
  });
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.getByRole('textbox', { name: 'Agent Hub instruction' }).fill('Look up the launch plan and delete the old task.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Approve deletion' }).waitFor();
  await page.getByText('Awaiting approval', { exact: true }).waitFor();
  await page.locator('.room-private-turn [data-avatar-state="waiting"]').waitFor();
  await page.getByRole('button', { name: 'Citation 1: Launch plan' }).click();
  await page.locator('[data-slot="inline-citation-card-body"]').getByText('Launch approved by the team.', { exact: true }).waitFor();
  await page.locator('[data-slot="inline-citation-card-body"]').getByText('Saved version: v1').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Agent Hub', exact: true }).hover();
  await page.getByRole('button', { name: 'Activity · 2 operations' }).click();
  await page.getByRole('button', { name: 'Used 1 sources' }).click();
  await page.getByText('Launch approved by the team.', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/nautilus-hub-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve deletion' }).click();
  await page.getByText('Approved', { exact: true }).waitFor();
  await page.locator('.room-private-turn [data-avatar-state="done"]').waitFor();
  await page.getByText('Completed', { exact: true }).waitFor();
  await page.locator('.room-private-turn [data-avatar-state="idle"]').waitFor();
  assert.equal(await page.locator('a[href="/kanban?task=task"]').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Citation 1: Launch plan' }).click();
  await page.locator('[data-slot="inline-citation-card-body"]').waitFor();
  await page.screenshot({ path: '/tmp/nautilus-hub-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile chat must not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log('Agent Hub Chromium checks passed: private chat, activity, structured citations, click-to-open evidence, sources, confirmation, task results and mobile layout.');
} finally { await browser?.close(); server.stop(true); }
