import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { agentChat } from '../src/agent-chat'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'

// The parent application provides authentication and membership middleware.
// Exercise this router's tenant predicate without a real database or LLM key.
function harness(found: boolean) {
  const lookups: unknown[] = []
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('organizationId', 'org-1')
    c.set('db', { agent: { findFirst: async (query: unknown) => {
      lookups.push(query)
      return found ? { id: 'agent-1', name: 'Scout', role: 'Research', rules: [] } : null
    } } } as unknown as Database)
    await next()
  })
  app.route('/agents', agentChat)
  app.onError((error, c) => c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500))
  return { app, lookups }
}

test('chat lookup scopes the agent to the current organization before resolving AI configuration', async () => {
  const { app, lookups } = harness(false)
  const response = await app.request('/agents/agent-1/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
  }, {})
  expect(response.status).toBe(404)
  expect(lookups[0]).toMatchObject({ where: { id: 'agent-1', organizationId: 'org-1' } })
})

test('chat reports unavailable AI without breaking unrelated endpoints', async () => {
  const { app } = harness(true)
  const response = await app.request('/agents/agent-1/chat', {
    method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
  }, {})
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: 'Agent AI is not configured.' })
})

test('chat rejects malformed or oversized input before looking up an agent', async () => {
  const { app, lookups } = harness(true)
  for (const [body, status] of [['{', 400], ['x'.repeat(256 * 1024 + 1), 413]] as const) {
    const response = await app.request('/agents/agent-1/chat', { method: 'POST', body }, {})
    expect(response.status).toBe(status)
  }
  expect(lookups).toHaveLength(0)
})
