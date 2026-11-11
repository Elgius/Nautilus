// Isolated development server: instant validation is dev-only. No real accounts or DB.
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const web = fileURLToPath(new URL('..', import.meta.url));
const fixture = await mkdtemp(path.join(web, '../.instant-workspace-'));
let nextServer, browser, serverLogs = '';
const organization = { id: 'instant-org', name: 'Test workspace', slug: 'instant' };
const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/me') return req.headers.cookie?.includes('fixture-session=signed-in')
    ? send({ user: { id: 'fixture-user', name: 'Test User', email: 'test@example.com', emailVerified: true, platformRole: 'user' }, memberships: [{ organizationId: organization.id, role: 'owner', organization }], activeOrganization: organization, needsOrganizationSelection: false })
    : send({ error: 'Unauthorized' }, 401);
  if (url.pathname.endsWith('/rooms')) return send({ rooms: [] });
  if (url.pathname.endsWith('/agents')) return send({ agents: [] });
  if (url.pathname.endsWith('/tasks')) return send({ tasks: [], nextCursor: null });
  if (url.pathname.endsWith('/documents')) return send({ documents: [], nextCursor: null });
  send({ error: 'Unexpected fixture request' }, 404);
});
try {
  await cp(web, fixture, { recursive: true, filter: (source) => {
    const relative = path.relative(web, source);
    return !relative || !/^(node_modules|\.next[^/]*|\.env[^/]*|tests|dist|tsconfig\.tsbuildinfo)(\/|$)/.test(relative);
  } });
  await symlink(path.join(web, 'node_modules'), path.join(fixture, 'node_modules'));
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const port = Number(process.env.INSTANT_TEST_PORT || 3102), base = `http://localhost:${port}`;
  nextServer = spawn(process.execPath, [fileURLToPath(import.meta.resolve('next/dist/bin/next')), 'dev', '--port', String(port)], {
    cwd: fixture, env: { ...process.env, API_ORIGIN: `http://127.0.0.1:${api.address().port}`, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  nextServer.stdout.on('data', (data) => { serverLogs += data; });
  nextServer.stderr.on('data', (data) => { serverLogs += data; });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (nextServer.exitCode !== null) throw new Error(serverLogs);
    if (serverLogs.includes('Ready in')) break;
    if (attempt === 119) throw new Error('Dev server did not start');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const failures = [];
  for (const signedIn of [false, true]) {
    const context = await browser.newContext();
    if (signedIn) await context.addCookies([{ name: 'fixture-session', value: 'signed-in', url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/?view=Knowledge`, { timeout: 90000 });
    if (signedIn) {
      await page.getByRole('heading', { name: 'Good work starts with good context.' }).waitFor({ timeout: 30000 });
      const shell = await page.locator('.workspace-shell').elementHandle();
      await page.getByRole('link', { name: 'Activity', exact: true }).click();
      await page.getByRole('heading', { name: 'Workspace timeline' }).waitFor();
      await page.getByRole('link', { name: 'Knowledge', exact: true }).click();
      await page.getByRole('heading', { name: 'Good work starts with good context.' }).waitFor();
      assert.ok(await shell.evaluate((node) => node === document.querySelector('.workspace-shell')), 'shell remounted during navigation');
    } else {
      await page.waitForURL(/\/login\?next=/, { timeout: 30000 });
      assert.equal(new URL(page.url()).searchParams.get('next'), '/?view=Knowledge');
      await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
      assert.equal(await page.locator('.workspace-shell').count(), 0, 'signed-out user saw workspace');
    }
    // Validation runs after hydration and may report through the overlay/console.
    await page.waitForTimeout(2500);
    const overlay = await page.locator('nextjs-portal').innerText().catch(() => '');
    if (errors.length || /Could not validate|Dropped segment|Instant Navigation/i.test(overlay)) failures.push({ signedIn, errors, overlay });
    console.log(`${signedIn ? 'Signed in' : 'Signed out'}: ${errors.length} browser errors`);
    await context.close();
  }
  assert.deepEqual(failures, [], 'Instant navigation or browser errors');
  assert.doesNotMatch(serverLogs, /Could not validate|Dropped segment|instant-unrendered-segment/);
  console.log('PASS: signed-in rendering/navigation and signed-out redirect pass instant validation in Turbopack development.');
} catch (error) {
  console.error(serverLogs.slice(-12000)); throw error;
} finally {
  await browser?.close();
  if (nextServer && nextServer.exitCode === null) { nextServer.kill(); await new Promise((resolve) => nextServer.once('exit', resolve)); }
  api.close();
  await rm(fixture, { recursive: true, force: true });
}
