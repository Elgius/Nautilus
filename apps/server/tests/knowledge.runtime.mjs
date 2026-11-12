import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = `
const state = { calls: 0, active: 0, maxActive: 0, status: 'pending' };
export const LEASE_MS = 1000;
export const stats = () => ({ ...state });
export const createDatabase = () => ({ $disconnect: async () => {}, knowledgeRun: { findUnique: async () => ({ status: state.status }) } });
export async function processKnowledgeStep() {
  state.calls++; state.active++; state.maxActive = Math.max(state.maxActive, state.active);
  await new Promise(resolve => setTimeout(resolve, 100)); state.active--;
  if (state.calls === 1) return new Date(Date.now() + 100);
  state.status = 'complete'; return null;
}`
const bundle = await build({
  stdin: { contents: `import { KnowledgeWorker } from './src/knowledge/worker'; import { stats } from 'knowledge-fixture';
    export class KnowledgeTestWorker extends KnowledgeWorker { async fetch(request) { if (new URL(request.url).pathname === '/stats') return Response.json(stats()); return super.fetch(request); } }
    export default { fetch(request, env) { return env.KNOWLEDGE_WORKER.get(env.KNOWLEDGE_WORKER.idFromName('test')).fetch(request); } };`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'],
  plugins: [{ name: 'knowledge-test', setup(builder) {
    builder.onResolve({ filter: /^(knowledge-fixture|\.\/runner|\.\.\/db)$/ }, () => ({ path: 'fixture', namespace: 'knowledge-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'knowledge-test' }, () => ({ contents: fixture, loader: 'ts' }))
  } }],
})
const mf = new Miniflare({ workers: [{ config: {
  name: 'knowledge-test', compatibilityDate: '2026-10-24', compatibilityFlags: ['nodejs_compat'],
  manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
  exports: { KnowledgeTestWorker: { type: 'durable-object', storage: 'sqlite' } },
  env: { KNOWLEDGE_WORKER: { type: 'durable-object', worker: 'knowledge-test', exportName: 'KnowledgeTestWorker' } },
} }] })
const wake = () => mf.dispatchFetch('https://knowledge.test/wake', { method: 'POST', body: JSON.stringify({ runId: '00000000-0000-4000-8000-000000000001' }) })
try {
  assert.equal((await mf.dispatchFetch('https://knowledge.test/wake')).status, 404)
  assert.equal((await wake()).status, 202)
  // Repeated cron deliveries overlap processing and must not lose the next alarm.
  for (let i = 0; i < 8; i++) { await new Promise(resolve => setTimeout(resolve, 40)); assert.equal((await wake()).status, 202) }
  const deadline = Date.now() + 5000
  let state
  do {
    state = await (await mf.dispatchFetch('https://knowledge.test/stats')).json()
    if (state.calls >= 2 && state.active === 0) break
    await new Promise(resolve => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  assert.equal(state.calls, 2, 'both checkpoint steps execute exactly once')
  assert.equal(state.maxActive, 1, 'alarms must not execute chunks concurrently')
  assert.equal(state.status, 'complete')
  console.log('Knowledge durable worker passed: wake validation, repeated deliveries, chunk continuation, and serialized alarms.')
} finally { await mf.dispose() }
