import { expect, test, spyOn } from 'bun:test'
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
    c.set('session', { user: { id: 'user-1' }, session: { id: 'session' } } as AppEnv['Variables']['session'])
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
  expect(lookups[0]).toMatchObject({ where: { id: 'agent-1', organizationId: 'org-1', createdByUserId: 'user-1' } })
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


test('roomless JSON responses include an explicit citations array and reject invented provenance', async () => {
  const { app } = harness(true)
  const mockedFetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => Response.json({ id: 'resp_test', model: 'gpt-test', created_at: 1, status: 'completed', usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    output: [{ type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: 'Hello [Made up](#source-invented)', annotations: [] }] }],
  }), { preconnect: globalThis.fetch.preconnect }))
  try {
    const response = await app.request('/agents/agent-1/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }) }, { OPENAI_API_KEY: 'test', LLM_MODEL: 'gpt-test' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ text: 'Hello [Made up](#source-invented)', citations: [] })
  } finally { mockedFetch.mockRestore() }
})

test('roomless streaming responses include citation JSON before the finish event', async () => {
  const { app } = harness(true)
  const events = [
    { type: 'response.created', response: { id: 'resp_test', model: 'gpt-test', created_at: 1 } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_test', role: 'assistant', content: [] } },
    { type: 'response.content_part.added', item_id: 'msg_test', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, content_index: 0, delta: 'Hello' },
    { type: 'response.completed', response: { id: 'resp_test', model: 'gpt-test', created_at: 1, status: 'completed', usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }, output: [] } },
  ]
  const mockedFetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }), { preconnect: globalThis.fetch.preconnect }))
  try {
    const response = await app.request('/agents/agent-1/chat', { method: 'POST', body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Hello' }] }) }, { OPENAI_API_KEY: 'test', LLM_MODEL: 'gpt-test' })
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('"type":"data-citations","data":{"citations":[]}')
    expect(body.indexOf('"type":"data-citations"')).toBeLessThan(body.lastIndexOf('"type":"finish"'))
  } finally { mockedFetch.mockRestore() }
})
